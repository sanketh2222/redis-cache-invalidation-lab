const config = require('../config');
const logger = require('../logging/logger');
const productService = require('./productService');


function parseWarmProductIds() {
  const raw = (config.cacheWarmProductIds || '').trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

async function warmConfiguredCache() {
  const ids = parseWarmProductIds();
  if (!ids.length) {
    return {
      ok: false,
      reason: 'CACHE_WARM_PRODUCT_IDS is empty — configure which product ids to warm',
      warmed: [],
    };
  }


  const warmed = [];
  for (const id of ids) {
    const product = await productService.getProductById(id);
    if (product) warmed.push(id);
  }

  logger.info('cache warmed for configured ids', { ids, warmed });
  return {
    ok: true,
    reason: 'Cache warmed for configured ids',
    configuredIds: ids,
    warmed,
  };
}

async function maybeWarmOnStartup() {
  if (!config.cacheWarmOnStartup) return;
  const result = await warmConfiguredCache();
  if (!result.ok) {
    logger.warn('startup cache warm skipped', { reason: result.reason });
  }
}

module.exports = { warmConfiguredCache, maybeWarmOnStartup, parseWarmProductIds };
