require("dotenv").config();

const axios = require("axios");
const express = require("express");
const bodyParser = require("body-parser");
const qs = require("querystring");
const ticket = require("./ticket");
const signature = require("./verifySignature");
const debug = require("debug")("slash-command-template:index");

const apiUrl = "https://slack.com/api";

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

/*
 * Endpoint to receive /helpdesk slash command from Slack.
 * Checks verification token and opens a dialog to capture more info.
 */
app.post("/event", (req, res) => {
  // extract the slash command text, and trigger ID from payload
  const { channel_id, text, user_id, user_name } = req.body;
  console.log(req.body);

  res.send({ response_type: "in_channel" });

  // Verify the signing secret
  if (signature.isVerified(req)) {
    const event = createEvent(user_id, text, user_name);

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
              color: "#6dc9da",
            },
            {
              fallback: "You are unable to RSVP.",
              color: "#6dc9da",
              actions: [
                {
                  name: "yes",
                  type: "button",
                  text: "I'll be there",
                  value: "yes",
                },
              ],
            },
            {
              fallback: "No one is attending at the moment.",
              color: "#6dc9da",
              title: "Attending",
              text: event.attending.map(el => `<@${el}>`).join(" "),
            },
            {
              text: "",
              color: "#6dc9da",
              footer: "Open Invites",
              footer_icon:
                "https://avatars.slack-edge.com/2018-12-07/498573284562_c6a410065a16442b683e_96.png",
            },
          ]),
        }),
      )
      .then(result => {
        console.log("sendConfirmation ", result.data);
        res.send("");
      })
      .catch(err => {
        console.log("sendConfirmation error", err);
        console.error(err);
        res.sendStatus(500);
      });
  } else {
    console.log("Verification token mismatch");
    res.sendStatus(404);
  }
});

const server = app.listen(process.env.PORT || 5000, () => {
  console.log(
    "Express server listening on port %d in %s mode",
    server.address().port,
    app.settings.env,
  );
});
