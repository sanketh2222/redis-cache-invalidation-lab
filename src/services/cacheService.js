const config = require('../config');
const keys = require('../redis/keys');
const { getRedis } = require('../redis/client');
const { runHook } = require('../testing/cacheHooks');
const logger = require('../logging/logger');
const {
  incrementCacheHit,
  incrementCacheMiss,
  incrementListHit,
  incrementListMiss,
} = require('../metrics/prometheus');

function serialize(product) {
  return JSON.stringify(product);
}

function deserialize(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function getCachedProduct(id) {
  const redis = await getRedis();
  const raw = await redis.get(keys.product(id));
  if (raw) {
    incrementCacheHit();
    return { hit: true, product: deserialize(raw) };
  }
  incrementCacheMiss();
  return { hit: false, product: null };
}

async function setCachedProduct(product) {
  const redis = await getRedis();
  await runHook('beforeCacheSet', { product });
  // NOTE: intentionally naive — no version check on write (race vulnerability).
  await redis.set(keys.product(product.id), serialize(product), {
    EX: config.productCacheTtlSeconds,
  });
  await runHook('afterCacheSet', { product });
}

async function getCachedList() {
  const redis = await getRedis();
  const raw = await redis.get(keys.productsList());
  if (raw) {
    incrementListHit();
    return deserialize(raw);
  }
  incrementListMiss();
  return null;
}

async function setCachedList(products) {
  const redis = await getRedis();
  // Starter bug: list cache has no TTL (detail keys do).
  await redis.set(keys.productsList(), serialize(products));
}

async function getCachedCategoryList(category) {
  const redis = await getRedis();
  const raw = await redis.get(keys.productsCategory(category));
  if (raw) {
    incrementListHit();
    return deserialize(raw);
  }
  incrementListMiss();
  return null;
}

async function setCachedCategoryList(category, products) {
  const redis = await getRedis();
  await redis.set(keys.productsCategory(category), serialize(products));
}

async function getNegativeCache(id) {
  const redis = await getRedis();
  const val = await redis.get(keys.negativeProduct(id));
  return val === '1';
}

async function setNegativeCache(id) {
  const redis = await getRedis();
  await redis.set(keys.negativeProduct(id), '1', {
    EX: config.negativeCacheTtlSeconds,
  });
}

/**
 * Invalidation is intentionally incomplete in the starter codebase.
 * Mutations should invalidate detail + dependent list keys — not fully wired yet.
 */
async function invalidateProductCaches(_productId, _oldCategory, _newCategory) {
  logger.debug('invalidateProductCaches called (starter implementation is a no-op stub)');
}

async function flushAllProductCacheKeys() {
  const redis = await getRedis();
  const toDelete = [];
  for await (const key of redis.scanIterator({ MATCH: 'product:*', COUNT: 100 })) {
    toDelete.push(key);
  }
  for await (const key of redis.scanIterator({ MATCH: 'products:*', COUNT: 100 })) {
    toDelete.push(key);
  }
  if (toDelete.length) await redis.del(toDelete);
}

module.exports = {
  getCachedProduct,
  setCachedProduct,
  getCachedList,
  setCachedList,
  getCachedCategoryList,
  setCachedCategoryList,
  getNegativeCache,
  setNegativeCache,
  invalidateProductCaches,
  flushAllProductCacheKeys,
};
