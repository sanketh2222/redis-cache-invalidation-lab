const { createApp } = require('../../src/app');
const { getRedis, closeRedis } = require('../../src/redis/client');
const cacheService = require('../../src/services/cacheService');
const { resetDbQueryCount } = require('../../src/testing/dbMetrics');
const { resetHooks } = require('../../src/testing/cacheHooks');

let server;

async function startTestServer() {
  resetDbQueryCount();
  resetHooks();
  await getRedis();
  await cacheService.flushAllProductCacheKeys();
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  const { port } = server.address();
  return { app, baseUrl: `http://127.0.0.1:${port}` };
}

async function stopTestServer() {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    server = null;
  }
  await closeRedis();
}

module.exports = { startTestServer, stopTestServer };
