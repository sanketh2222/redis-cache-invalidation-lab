const { createClient } = require('redis');
const config = require('../config');
const logger = require('../logging/logger');

let client;
let connected = false;

async function getRedis() {
  if (client) return client;
  client = createClient({ url: config.redisUrl });
  client.on('error', (err) => logger.error('redis client error', { err: String(err) }));
  await client.connect();
  connected = true;
  return client;
}

function isRedisConnected() {
  return connected;
}

async function closeRedis() {
  if (client && connected) {
    await client.quit();
    connected = false;
    client = null;
  }
}

module.exports = { getRedis, closeRedis, isRedisConnected };
