const Redis = require("redis");
const bluebird = require("bluebird");

bluebird.promisifyAll(Redis.RedisClient.prototype);
bluebird.promisifyAll(Redis.Multi.prototype);

module.exports = Redis.createClient({});
