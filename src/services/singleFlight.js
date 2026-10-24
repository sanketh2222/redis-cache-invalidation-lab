/**
 * Stampede protection for GET-by-id via a Redis distributed lock.
 *
 * Cross-host: SET NX on lock:product:<id> with a random token and PX TTL; release uses
 * Lua compare-and-delete so a stale holder cannot delete a new owner's lock.
 * One leader rechecks the cache under the lock, loads from DB, and writes product or
 * negative cache. Losers poll product + negative keys with exponential backoff; they
 * exit early when the lock key is absent (lockGone), then may tryLeadLoad with at most
 * MAX_WAIT_ATTEMPTS full wait cycles before finishAfterTimedOut (try lock, else DB).
 *
 * In-process promise coalescing (per-id Map) is not implemented yet (see gap 5 tests).
 */
const { getRedis } = require('../redis/client');
const keys = require('../redis/keys');
const { lockKey, acquireLock, releaseLock, LOCK_TTL_MS } = require('../redis/productLock');
const cacheService = require('./cacheService');
const productRepository = require('../repositories/productRepository');
const logger = require('../logging/logger');
const CacheUnavailableError = require('../errors/CacheUnavailableError');
const {
  incrementCacheHit,
  incrementCacheMiss,
} = require('../metrics/prometheus');

/** Max full waitForCache cycles after the initial tryLeadLoad loses (not per-poll ticks). */
const MAX_WAIT_ATTEMPTS = 2;

const DEFAULT_WAIT_OPTS = {
  baseDelayMs: 25,
  maxDelayMs: 500,
  maxWaitMs: 25_000,
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitterMs(maxJitter) {
  return Math.floor(Math.random() * maxJitter);
}

function deserializeProduct(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
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

/**
 * Waiter poll only: one Redis round trip. Hit/miss counters mirror getCachedProduct
 * (one miss per poll when the product key is absent; negative key does not add another).
 */
async function pollState(id) {
  const redis = await getRedis();
  const [productRaw, negativeRaw, lockExists] = await redis
    .multi()
    .get(keys.product(id))
    .get(keys.negativeProduct(id))
    .exists(lockKey(id))
    .exec();

  if (productRaw) {
    incrementCacheHit();
    const product = deserializeProduct(productRaw);
    if (product) {
      return { status: 'hit', product, lockPresent: Boolean(lockExists) };
    }
  } else {
    incrementCacheMiss();
  }

  if (negativeRaw === '1') {
    return { status: 'negative', product: null, lockPresent: Boolean(lockExists) };
  }

  return { status: 'miss', product: null, lockPresent: Boolean(lockExists) };
}

async function waitForCache(id, opts = {}) {
  const { baseDelayMs, maxDelayMs, maxWaitMs } = { ...DEFAULT_WAIT_OPTS, ...opts };
  const deadline = Date.now() + maxWaitMs;
  let delay = baseDelayMs;

  while (Date.now() < deadline) {
    const state = await pollState(id);
    if (state.status === 'hit') {
      return { outcome: 'ready', product: state.product };
    }
    if (state.status === 'negative') {
      return { outcome: 'ready', product: null };
    }

    if (!state.lockPresent) {
      return { outcome: 'lockGone' };
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
    try {
      await cacheService.setNegativeCache(id);
    } catch (err) {
      if (err instanceof CacheUnavailableError) {
        logger.warn('negative cache write failed; returning not found', { err, id });
        return null;
      }
      throw err;
    }
    return null;
  }
  try {
    await cacheService.setCachedProduct(fromDb);
  } catch (err) {
    if (err instanceof CacheUnavailableError) {
      logger.warn('product cache write failed; returning DB row', { err, id });
      return fromDb;
    }
    throw err;
  }
  return fromDb;
}

async function tryLeadLoad(id) {
  const token = await acquireLock(id);
  if (!token) {
    return { led: false };
  }

  try {
    const again = await tryReadCache(id);
    if (again.status === 'hit') {
      logger.debug('cache hit for product', { id });
      return { led: true, product: again.product };
    }
    if (again.status === 'negative') {
      logger.debug('negative cache hit for product', { id });
      return { led: true, product: null };
    }

    try {
      const product = await loadAndCache(id);
      return { led: true, product };
    } catch (err) {
      logger.error('single-flight loader failed', { err, id });
      throw err;
    }
  } finally {
    await releaseLock(id, token);
  }
}

async function finishAfterTimedOut(id) {
  const led = await tryLeadLoad(id);
  if (led.led) {
    return led.product;
  }
  logger.warn('single-flight wait timed out; falling back to DB', { id });
  return loadAndCache(id);
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

  const initialLead = await tryLeadLoad(id);
  if (initialLead.led) {
    return initialLead.product;
  }

  for (let attempt = 0; attempt < MAX_WAIT_ATTEMPTS; attempt++) {
    const waited = await waitForCache(id);
    if (waited.outcome === 'ready') {
      return waited.product;
    }
    if (waited.outcome === 'timedOut') {
      break;
    }

    const led = await tryLeadLoad(id);
    if (led.led) {
      return led.product;
    }
  }

  return finishAfterTimedOut(id);
}

module.exports = {
  LOCK_TTL_MS,
  acquireLock,
  releaseLock,
  waitForCache,
  getWithSingleFlight,
};
