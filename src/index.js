require("dotenv").config();

const express = require("express");
const bodyParser = require("body-parser");
const qs = require("querystring");
const signature = require("./verifySignature");
const debug = require("debug")("slash-command-template:index");
const chrono = require("chrono-node");
const queryString = require("query-string");
const dateFormat = require("dateformat");
const api = require("./apiActions");

const { getEmoji } = require("./emojis");

const app = express();

let oauthToken;
const DEFAULT_ATTENDING_MSG = ":see_no_evil: _No one is attending yet._";
/*
 * Parse application/x-www-form-urlencoded && application/json
 * Use body-parser's `verify` callback to export a parsed raw body
 * that you need to use to verify the signature
 */

const rawBodyBuffer = (req, res, buf, encoding) => {
  if (buf && buf.length) {
    req.rawBody = buf.toString(encoding || "utf8");
  }
};

app.use(bodyParser.urlencoded({ verify: rawBodyBuffer, extended: true }));
app.use(bodyParser.json({ verify: rawBodyBuffer }));

app.get("/", (req, res) => {
  res.send(
    "<h2>The Slash Command and Dialog app is running</h2> <p>Follow the" +
      " instructions in the README to configure the Slack App and your environment variables.</p>" +
      '<a href="https://slack.com/oauth/authorize?client_id=2171069148.498357548532&scope=commands,bot,users:read,users:read.email,chat:write:bot,links:read"><img alt="Add to Slack" height="40" width="139" src="https://platform.slack-edge.com/img/add_to_slack.png" srcset="https://platform.slack-edge.com/img/add_to_slack.png 1x, https://platform.slack-edge.com/img/add_to_slack@2x.png 2x" /></a>',
  );
});

app.get("/success", (req, res) => {
  res.send("<h2>Success! App has been authorized!</h2>");
});

const createEvent = (userId, title, userName) => ({ userId, title, attending: [userId] });

/*
 * Endpoint to receive /whosin slash command from Slack.
 */
app.post("/flamingo", (req, res) => {
  // extract the slash command text, and trigger ID from payload
  const { channel_id, text, user_id, user_name } = req.body;

  res.send(text.length > 0 ? { response_type: "in_channel" } : "");

  // Verify the signing secret
  if (signature.isVerified(req)) {
    if (text.length === 0) {
      // Message is empty.
      api.createUsageMessage(user_id, channel_id);
    } else {
      const event = createEvent(user_id, text, user_name);
      const emoji = getEmoji(text);

      api.createInviteMessage(channel_id, event.title, event.attending, emoji);
    }
  } else {
    console.log("Verification token mismatch");
    res.sendStatus(404);
  }
});

/**
 * Handles canceling event logic.
 */
const cancelEvent = (req, res) => {
  const { channel, user, original_message, callback_id, message_ts, ts, message } = JSON.parse(
    req.body.payload,
  );

  const current_user = `<@${user.id}>`;

  // Deletes event
  const previousTitle = message.attachments[0].text || "";
  const title = previousTitle.substring(20, previousTitle.length - 1);

  const previousAttending = message.attachments[2].text || "";
  const attending = previousAttending === DEFAULT_ATTENDING_MSG ? [] : previousAttending.split(" ");

  api.deleteMessage(channel.id, user.id, message_ts);

  attending.map(el => {
    const userId = el.substring(2, el.length - 1);
    const text = `${current_user} canceled the event: *${title}*`;
    api.createCancellationMessage(channel.id, userId, text);
  });
};

/**
 * Update attending list.
 */
const updateAttending = (req, res) => {
  const { payload, ...rest } = req.body;
  const { channel, user, original_message, message_ts, ts, message } = JSON.parse(req.body.payload);

  const current_user = `<@${user.id}>`;

  // Handles event response
  const previousTitle = original_message.attachments[0].text || "";
  const title = previousTitle.substring(20, previousTitle.length - 1);

  const attendingText = original_message.attachments[2].text || "";
  const previousAttending = attendingText === DEFAULT_ATTENDING_MSG ? [] : attendingText.split(" ");

  const isAlreadyGoing =
    previousAttending.length > 0 && previousAttending.indexOf(current_user) > -1;
  const attending = isAlreadyGoing
    ? previousAttending.filter(el => el !== current_user).join(" ")
    : [...previousAttending, current_user].join(" ");

  api.updateInviteMessage(channel.id, attending, original_message.ts, original_message.attachments);

  if (!isAlreadyGoing) {
    // Generate Google Calendar link

    api.fetchPermalink(channel.id, original_message.ts).then(response => {
      const parsedDate = chrono.parse(title)[0];
      const permalink = response.data.permalink;

      const startDate = parsedDate ? parsedDate.start.date() : new Date();
      const oneHourAhead = new Date(startDate.getTime() + 1 * 60 * 60 * 1000);
      const endDate = (parsedDate && parsedDate.end) ? parsedDate.end.date() : oneHourAhead;
      const fmtStartDate = dateFormat(startDate, "UTC:yyyymmdd'T'HHMMss'Z'");
      const fmtEndDate = dateFormat(endDate, "UTC:yyyymmdd'T'HHMMss'Z'");

      const gcalLink = `http://www.google.com/calendar/event?${queryString.stringify({
        action: "TEMPLATE",
        text: title,
        dates: `${fmtStartDate}/${fmtEndDate}`,
        details: `Event created by Flamingo via Slack.\n${permalink}`,
      })}`;

      api.createCalendarMessage(channel.id, user.id, gcalLink);
    });
  }
};

app.post("/response", async (req, res) => {
  res.send("");
  const { payload, ...rest } = req.body;
  const { callback_id } = JSON.parse(payload);

  if (callback_id === "cancel_event") {
    await cancelEvent(req, res);
  } else if (callback_id === "event_rsvp") {
    await updateAttending(req, res);
  }
});

app.get("/auth", function(req, res) {
  if (!req.query.code) {
    return;
  }

  api
    .postOAuth(req.query.code)
    .then(response => {
      oauthToken = response.data.access_token;
      if (oauthToken) {
        res.redirect("/success");
      } else {
        res.redirect("/");
      }
    })
    .catch(error => console.error(error));
});

const server = app.listen(process.env.PORT || 5000, () => {
  console.log(
    "Express server listening on port %d in %s mode",
    server.address().port,
    app.settings.env,
  );
});
