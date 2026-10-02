const { warmConfiguredCache } = require('../services/cacheWarmer');

async function warmCache(_req, res) {
  const result = await warmConfiguredCache();
  if (!result.ok) {
    return res.status(501).json({
      error: 'Cache warming not completed',
      detail: result.reason,
      configuredIds: result.configuredIds || [],
    });
  }
  return res.json(result);
}

module.exports = { warmCache };
