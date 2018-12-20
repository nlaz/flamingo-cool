require("dotenv").config();

const axios = require("axios");
const express = require("express");
const bodyParser = require("body-parser");
const qs = require("querystring");
const signature = require("./verifySignature");
const debug = require("debug")("slash-command-template:index");
const chrono = require("chrono-node");
const queryString = require("query-string");
const dateFormat = require("dateformat");

const apiUrl = "https://slack.com/api";
const { getEmoji } = require("./emojis");

const app = express();

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
      " instructions in the README to configure the Slack App and your environment variables.</p>",
  );
});

const createEvent = (userId, title, userName) => ({
  userId,
  title,
  attending: [userId],
});

const getPermalink = (channelId, message_ts) => {
  return axios.get(
    "https://slack.com/api/chat.getPermalink?" +
      qs.stringify({
        token: process.env.SLACK_ACCESS_TOKEN,
        channel: channelId,
        message_ts: message_ts,
      }),
  );
};

const createUsageMessage = (userId, channelId) => {
  axios
    .post(
      "https://slack.com/api/chat.postEphemeral",
      qs.stringify({
        token: process.env.SLACK_ACCESS_TOKEN,
        channel: channelId,
        as_user: true,
        user: userId,
        text:
          "To create an invitation, try to formatting your message like this: \n `/whosin happy hour next week on wednesday 5pm-6pm`",
      }),
    )
    .catch(err => {
      console.error(err);
    });
};

/*
 * Endpoint to receive /whosin slash command from Slack.
 */
app.post("/flamingo", (req, res) => {
  // extract the slash command text, and trigger ID from payload
  const { channel_id, text, user_id, user_name } = req.body;

  if (text.length > 0) {
    res.send({ response_type: "in_channel" });
  } else {
    res.send("");
  }

  // Verify the signing secret
  if (signature.isVerified(req)) {
    if (text.length > 0) {
      let gcalLink = "";
      const event = createEvent(user_id, text, user_name);

      const feedbackLink = "https://goo.gl/forms/IY9t25qqNWYLgW9u2";
      const parsedDate = chrono.parse(event.title)[0];
      const emoji = getEmoji(text);

      if (parsedDate) {
        const startDate = parsedDate.start.date();
        const oneHourAhead = new Date(startDate.getTime() + 1 * 60 * 60 * 1000);
        const endDate = parsedDate.end ? parsedDate.end.date() : oneHourAhead;
        const fmtStartDate = dateFormat(startDate, "UTC:yyyymmdd'T'HHMMss'Z'");
        const fmtEndDate = dateFormat(endDate, "UTC:yyyymmdd'T'HHMMss'Z'");

        gcalLink = `http://www.google.com/calendar/event?${queryString.stringify({
          action: "TEMPLATE",
          text: event.title,
          dates: `${fmtStartDate}/${fmtEndDate}`,
        })}`;
      }

      axios
        .post(
          "https://slack.com/api/chat.postMessage",
          qs.stringify({
            token: process.env.SLACK_ACCESS_TOKEN,
            channel: channel_id,
            as_user: true,
            attachments: JSON.stringify([
              {
                text: `You're invited to:\n *${event.title}*`,
                color: "#6ECADC",
              },
              {
                fallback: "You are unable to RSVP.",
                color: "#6ECADC",
                callback_id: "event_rsvp",
                actions: [
                  {
                    name: "yes",
                    type: "button",
                    text: `${emoji} I'll be there`,
                    value: "yes",
                  },
                ],
              },
              {
                fallback: "No one is attending at the moment.",
                color: "#6ECADC",
                title: "Attending",
                text: event.attending.map(el => `<@${el}>`).join(" "),
              },
              {
                text: "",
                color: "#6ECADC",
                footer: `Felix    <${feedbackLink}|Feedback>`,
                footer_icon:
                  "https://avatars.slack-edge.com/2018-12-11/502563278519_39d786b2bb6ef9fbab5a_96.png",
              },
            ]),
          }),
        )
        .catch(err => {
          console.error(err);
        });
    } else {
      // Message is empty.
      createUsageMessage(user_id, channel_id);
    }
  } else {
    console.log("Verification token mismatch");
    res.sendStatus(404);
  }
});

const DEFAULT_ATTENDING_MSG = ":see_no_evil: _No one is attending yet._";

app.post("/response", (req, res) => {
  const { payload, ...rest } = req.body;
  res.send("");
  const { channel, user, original_message, callback_id, message_ts, ts, message } = JSON.parse(
    req.body.payload,
  );

  const current_user = `<@${user.id}>`;

  if (callback_id === "delete_event") {
    // Deletes event
    const previousTitle = message.attachments[0].text || "";
    const title = previousTitle.substring(21, previousTitle.length - 1);

    const previousAttending = message.attachments[2].text || "";
    const attending =
      previousAttending === DEFAULT_ATTENDING_MSG ? [] : previousAttending.split(" ");

    axios.post(
      "https://slack.com/api/chat.delete",
      qs.stringify({
        token: process.env.SLACK_ACCESS_TOKEN,
        channel: channel.id,
        as_user: true,
        user: user.id,
        ts: message_ts,
      }),
    );

    attending.map(el => {
      const userId = el.substring(2, el.length - 1);
      axios.post(
        "https://slack.com/api/chat.postEphemeral",
        qs.stringify({
          token: process.env.SLACK_ACCESS_TOKEN,
          channel: channel.id,
          as_user: true,
          user: userId,
          text: `${current_user} canceled the event: *${title}*`,
        }),
      );
    });
  } else if (callback_id === "event_rsvp") {
    // Handles event response
    const previousTitle = original_message.attachments[0].text || "";
    const title = previousTitle.substring(21, previousTitle.length - 1);

    const previousAttending = original_message.attachments[2].text || "";
    const attending =
      previousAttending === DEFAULT_ATTENDING_MSG ? [] : previousAttending.split(" ");

    const isAlreadyGoing = attending.length > 0 && attending.indexOf(current_user) > -1;
    const updated = isAlreadyGoing
      ? attending.filter(el => el !== current_user).join(" ")
      : [...attending, current_user].join(" ");

    if (!isAlreadyGoing) {
      // Generate Google Calendar link

      getPermalink(channel.id, original_message.ts)
        .then(response => {
          const parsedDate = chrono.parse(title)[0];
          const permalink = response.data.permalink;

          const startDate = parsedDate ? parsedDate.start.date() : new Date();
          const oneHourAhead = new Date(startDate.getTime() + 1 * 60 * 60 * 1000);
          const endDate = parsedDate.end ? parsedDate.end.date() : oneHourAhead;
          const fmtStartDate = dateFormat(startDate, "UTC:yyyymmdd'T'HHMMss'Z'");
          const fmtEndDate = dateFormat(endDate, "UTC:yyyymmdd'T'HHMMss'Z'");

          const gcalLink = `http://www.google.com/calendar/event?${queryString.stringify({
            action: "TEMPLATE",
            text: title,
            dates: `${fmtStartDate}/${fmtEndDate}`,
            details: `Event created by Felix via Slack:\n\n${permalink}`,
          })}`;

          axios.post(
            "https://slack.com/api/chat.postEphemeral",
            qs.stringify({
              token: process.env.SLACK_ACCESS_TOKEN,
              channel: channel.id,
              as_user: true,
              user: user.id,
              text: "Sweet you’re in! Add it to your calendar:",
              attachments: JSON.stringify([
                {
                  fallback: gcalLink,
                  color: "#6dc9da",
                  actions: [
                    {
                      type: "button",
                      text: "Add to calendar",
                      url: gcalLink,
                    },
                  ],
                },
              ]),
            }),
          );
        })
        .catch(err => console.error(err));
    }

    axios
      .post(
        "https://slack.com/api/chat.update",
        qs.stringify({
          token: process.env.SLACK_ACCESS_TOKEN,
          channel: channel.id,
          as_user: true,
          ts: original_message.ts,
          attachments: JSON.stringify([
            original_message.attachments[0],
            original_message.attachments[1],
            {
              fallback: "No one is attending at the moment.",
              color: "#6dc9da",
              title: "Attending",
              text: updated || DEFAULT_ATTENDING_MSG,
            },
            original_message.attachments[3],
          ]),
        }),
      )
      .catch(err => {
        console.error(err);
      });
  }
});

const server = app.listen(process.env.PORT || 5000, () => {
  console.log(
    "Express server listening on port %d in %s mode",
    server.address().port,
    app.settings.env,
  );
});
