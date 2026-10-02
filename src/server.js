const config = require('./config');
const { createApp } = require('./app');
const { getRedis } = require('./redis/client');
const { maybeWarmOnStartup } = require('./services/cacheWarmer');
const logger = require('./logging/logger');

async function main() {
  await getRedis();
  await maybeWarmOnStartup();
  const app = createApp();
  app.listen(config.port, () => {
    logger.info(`API listening on http://localhost:${config.port}`, {
      instance: config.instanceId,
    });
  });
}

main().catch((err) => {
  logger.error('failed to start server', { err: String(err) });
  process.exit(1);
});
