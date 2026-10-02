const express = require('express');
const productsRouter = require('./routes/products');
const adminRouter = require('./routes/admin');
const { getDbQueryCount, resetDbQueryCount } = require('./testing/dbMetrics');
const { getRedis } = require('./redis/client');
const { renderMetrics } = require('./metrics/prometheus');
const logger = require('./logging/logger');

function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ ok: true, instance: process.env.INSTANCE_ID || 'api-local' });
  });

  app.get('/metrics', async (_req, res) => {
    try {
      const redis = await getRedis();
      const body = await renderMetrics(redis);
      res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      res.send(body);
    } catch (err) {
      logger.error('metrics scrape failed', { err: String(err) });
      res.status(500).send('# metrics unavailable\n');
    }
  });

  app.get('/debug/db-query-count', (_req, res) => {
    res.json({ count: getDbQueryCount() });
  });

  app.post('/debug/db-query-count/reset', (_req, res) => {
    resetDbQueryCount();
    res.json({ ok: true });
  });

  app.use('/admin', adminRouter);
  app.use('/products', productsRouter);

  app.use((err, _req, res, _next) => {
    logger.error('request failed', { err: String(err), status: err.status });
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Internal Server Error' });
  });

  return app;
}

module.exports = { createApp };
