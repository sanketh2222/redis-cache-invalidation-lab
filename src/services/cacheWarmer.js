const config = require('../config');
const logger = require('../logging/logger');

/**
 * Cache warming is intentionally incomplete.
 * Configure via CACHE_WARM_PRODUCT_IDS and CACHE_WARM_INCLUDE_LIST, then implement warmConfiguredCache().
 */

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

  logger.info('cache warm requested but not implemented in starter code', { ids });
  return {
    ok: false,
    reason: 'warmConfiguredCache() is a stub — implement warming for configured ids (and optional list)',
    configuredIds: ids,
    includeList: config.cacheWarmIncludeList,
    warmed: [],
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
