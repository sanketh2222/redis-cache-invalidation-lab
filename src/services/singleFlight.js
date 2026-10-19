/**
 * Stampede protection via a Redis distributed lock.
 *
 * In-process coalescing (a Map of id -> Promise) dedupes concurrent misses in one
 * Node process only. Multiple API instances on separate hosts share Redis but not
 * memory, so SET NX + token + Lua release is the minimal cross-host mutex: one
 * leader fills the cache while waiters poll with backoff.
 */
const crypto = require('crypto');
const { getRedis } = require('../redis/client');
const cacheService = require('./cacheService');
const productRepository = require('../repositories/productRepository');
const logger = require('../logging/logger');

/** Half of typical 60s gateway timeout; safety ceiling, not expected DB duration. */
const LOCK_TTL_MS = 30_000;

const DEFAULT_WAIT_OPTS = {
  baseDelayMs: 25,
  maxDelayMs: 500,
  maxWaitMs: 25_000,
};

/**
 * Plain GET then DEL is unsafe: the lock can expire and another holder can acquire
 * between GET and DEL, so DEL would remove the new owner's lock.
 */
const RELEASE_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

function lockKey(id) {
  return `lock:product:${id}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitterMs(maxJitter) {
  return Math.floor(Math.random() * maxJitter);
}

async function tryReadCache(id) {
  const cached = await cacheService.getCachedProduct(id);
  if (cached.hit && cached.product) {
    return { status: 'hit', product: cached.product };
  }
  if (await cacheService.getNegativeCache(id)) {
    return { status: 'negative', product: null };
  }
  return { status: 'miss' };
}

async function acquireLock(id, ttlMs = LOCK_TTL_MS) {
  const redis = await getRedis();
  const token = crypto.randomUUID();
  const key = lockKey(id);
  const ok = await redis.set(key, token, { NX: true, PX: ttlMs });
  return ok ? token : null;
}

async function releaseLock(id, token) {
  if (!token) return;
  const redis = await getRedis();
  await redis.eval(RELEASE_LOCK_SCRIPT, {
    keys: [lockKey(id)],
    arguments: [token],
  });
}

async function waitForCache(id, opts = {}) {
  const { baseDelayMs, maxDelayMs, maxWaitMs } = { ...DEFAULT_WAIT_OPTS, ...opts };
  const deadline = Date.now() + maxWaitMs;
  let delay = baseDelayMs;

  while (Date.now() < deadline) {
    const read = await tryReadCache(id);
    if (read.status === 'hit') {
      return { outcome: 'ready', product: read.product };
    }
    if (read.status === 'negative') {
      return { outcome: 'ready', product: null };
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    const waitMs = Math.min(delay + jitterMs(Math.ceil(delay * 0.2)), maxDelayMs, remaining);
    await sleep(waitMs);
    delay = Math.min(delay * 2, maxDelayMs);
  }

  return { outcome: 'timedOut' };
}

async function loadAndCache(id) {
  const fromDb = await productRepository.findById(id);
  if (!fromDb) {
    logger.debug('negative cache for product', { id });
    await cacheService.setNegativeCache(id);
    return null;
  }
  await cacheService.setCachedProduct(fromDb);
  return fromDb;
}

async function getWithSingleFlight(id) {
  const read = await tryReadCache(id);
  if (read.status === 'hit') {
    logger.debug('cache hit for product', { id });
    return read.product;
  }
  if (read.status === 'negative') {
    logger.debug('negative cache hit for product', { id });
    return null;
  }

  const token = await acquireLock(id);
  if (token) {
    try {
      const again = await tryReadCache(id);
      if (again.status === 'hit') {
        logger.debug('cache hit for product', { id });
        return again.product;
      }
      if (again.status === 'negative') {
        logger.debug('negative cache hit for product', { id });
        return null;
      }

      try {
        return await loadAndCache(id);
      } catch (err) {
        logger.error({ err, id }, 'single-flight loader failed');
        throw err;
      }
    } finally {
      await releaseLock(id, token);
    }
  }

  const waited = await waitForCache(id);
  if (waited.outcome === 'ready') {
    return waited.product;
  }

  logger.debug('single-flight wait timed out; falling back to DB', { id });
  return loadAndCache(id);
}

module.exports = {
  LOCK_TTL_MS,
  acquireLock,
  releaseLock,
  waitForCache,
  getWithSingleFlight,
};
