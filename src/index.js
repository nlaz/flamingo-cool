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
const redis = require("./redis");

const { getEmoji } = require("./emojis");

const app = express();

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

redis.on("error", function(err) {
  console.error("Error " + err);
});

app.use(bodyParser.urlencoded({ verify: rawBodyBuffer, extended: true }));
app.use(bodyParser.json({ verify: rawBodyBuffer }));

app.use(express.static(__dirname + "/public"));

app.get("/", function(req, res) {
  res.sendfile(__dirname + "/public/index.html");
});

app.get("/success", (req, res) => {
  res.sendfile(__dirname + "/public/success.html");
});

const createEvent = (userId, title, userName) => ({ userId, title, attending: [userId] });

/*
 * Endpoint to receive /whosin slash command from Slack.
 */
app.post("/flamingo", async (req, res) => {
  // extract the slash command text, and trigger ID from payload
  const { channel_id, text, user_id, user_name, team_id } = req.body;
  const token = await redis.getAsync(team_id);

  res.send(text.length > 0 ? { response_type: "in_channel" } : "");

  // Verify the signing secret
  if (signature.isVerified(req)) {
    if (text.length === 0 || text === "help") {
      // Message is empty.
      api.createUsageMessage(token, user_id, channel_id);
    } else {
      const event = createEvent(user_id, text, user_name);
      const emoji = getEmoji(text);

      api.createInviteMessage(token, channel_id, event.title, event.attending, emoji);
    }
  } else {
    console.log("Verification token mismatch");
    res.sendStatus(404);
  }
});

/**
 * Handles canceling event logic.
 */
const cancelEvent = async (req, res) => {
  const payload = JSON.parse(req.body.payload);
  const { channel, user, team, message_ts, message } = payload;

  // Fetch token from redis
  const token = await redis.getAsync(team.id);

  const current_user = `<@${user.id}>`;

  // Deletes event
  const previousTitle = message.attachments[0].text || "";
  const title = previousTitle.substring(20, previousTitle.length - 1);

  const previousAttending = message.attachments[2].text || "";
  const attending = previousAttending === DEFAULT_ATTENDING_MSG ? [] : previousAttending.split(" ");

  api.deleteMessage(token, channel.id, user.id, message_ts);

  attending.map(el => {
    const userId = el.substring(2, el.length - 1);
    const text = `${current_user} canceled the event: *${title}*`;
    api.createCancellationMessage(token, channel.id, userId, text);
  });
};

/**
 * Update attending list.
 */
const updateAttending = async (req, res) => {
  const { channel, user, original_message, message_ts, team } = JSON.parse(req.body.payload);

  // Fetch token from redis
  const token = await redis.getAsync(team.id);

  const current_user = `<@${user.id}>`;

  // Handles event response
  const previousTitle = original_message.attachments[0].text || "";
  const title = previousTitle.substring(20, previousTitle.length - 1);

  const attendingText = original_message.attachments[1].text || "";
  const previousAttending = attendingText === DEFAULT_ATTENDING_MSG ? [] : attendingText.split(" ");

  const isAlreadyGoing =
    previousAttending.length > 0 && previousAttending.indexOf(current_user) > -1;
  const attending = isAlreadyGoing
    ? previousAttending.filter(el => el !== current_user).join(" ")
    : [...previousAttending, current_user].join(" ");

  api.updateInviteMessage(
    token,
    channel.id,
    attending,
    original_message.ts,
    original_message.attachments,
  );

  if (!isAlreadyGoing) {
    // Generate Google Calendar link

    api.fetchPermalink(token, channel.id, original_message.ts).then(response => {
      const parsedDate = chrono.parse(title)[0];
      const permalink = response.data.permalink;

      const startDate = parsedDate ? parsedDate.start.date() : new Date();
      const oneHourAhead = new Date(startDate.getTime() + 1 * 60 * 60 * 1000);
      const endDate = parsedDate && parsedDate.end ? parsedDate.end.date() : oneHourAhead;
      const fmtStartDate = dateFormat(startDate, "UTC:yyyymmdd'T'HHMMss'Z'");
      const fmtEndDate = dateFormat(endDate, "UTC:yyyymmdd'T'HHMMss'Z'");

      const gcalLink = `http://www.google.com/calendar/event?${queryString.stringify({
        action: "TEMPLATE",
        text: title,
        dates: `${fmtStartDate}/${fmtEndDate}`,
        details: `Event created by Flamingo via Slack.\n${permalink}`,
      })}`;

      api.createCalendarMessage(token, channel.id, user.id, gcalLink);
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
    res.redirect("/?error=invalid_code");
    return;
  }

  api
    .postOAuth(req.query.code)
    .then(async response => {
      const { access_token, team_id } = response.data;
      if (access_token) {
        await redis.set(team_id, access_token);
        res.redirect("/success");
      } else {
        res.redirect("/?error=invalid_authentication");
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
