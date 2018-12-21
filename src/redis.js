const Redis = require("redis");
const bluebird = require("bluebird");
const url = require("url");

bluebird.promisifyAll(Redis.RedisClient.prototype);
bluebird.promisifyAll(Redis.Multi.prototype);

let client;
if (process.env.REDIS_URL) {
  const redisURL = url.parse(process.env.REDIS_URL);
  client = Redis.createClient(redisURL.port, redisURL.hostname);
  client.auth(redisURL.auth.split(":")[1]);
} else {
  client = Redis.createClient({});
}

module.exports = client;
