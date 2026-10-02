/**
 * Deterministic hooks for concurrency / race-condition tests.
 * Enabled when NODE_ENV=test or ENABLE_CACHE_HOOKS=1.
 */

const hooks = {
  beforeDbRead: null,
  afterDbRead: null,
  beforeCacheSet: null,
  afterCacheSet: null,
};

function hooksEnabled() {
  return process.env.NODE_ENV === 'test' || process.env.ENABLE_CACHE_HOOKS === '1';
}

async function runHook(name, ...args) {
  if (!hooksEnabled() || typeof hooks[name] !== 'function') return;
  await hooks[name](...args);
}

function resetHooks() {
  hooks.beforeDbRead = null;
  hooks.afterDbRead = null;
  hooks.beforeCacheSet = null;
  hooks.afterCacheSet = null;
}

module.exports = { hooks, runHook, resetHooks, hooksEnabled };
