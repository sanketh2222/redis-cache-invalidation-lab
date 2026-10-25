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

function productVersion(product) {
  const n = Number(product?.version);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * Atomically SET product JSON only if incoming version is not older than cached.
 * Returns 1 when written, 0 when rejected (stale).
 */
const SET_PRODUCT_IF_NOT_STALE_SCRIPT = `
local key = KEYS[1]
local payload = ARGV[1]
local incoming = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])

if incoming == nil or incoming < 1 then
  incoming = 1
end

local raw = redis.call('GET', key)
if raw then
  local cached = tonumber(string.match(raw, '"version"%s*:%s*(%d+)'))
  if cached == nil then
    cached = 1
  end
  if incoming < cached then
    return 0
  end
end

redis.call('SET', key, payload, 'EX', ttl)
return 1
`;

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

  const key = keys.product(product.id);
  const incomingVersion = productVersion(product);
  const toStore = { ...product, version: incomingVersion };

  const written = await redis.eval(SET_PRODUCT_IF_NOT_STALE_SCRIPT, {
    keys: [key],
    arguments: [
      serialize(toStore),
      String(incomingVersion),
      String(config.productCacheTtlSeconds),
    ],
  });

  if (Number(written) === 0) {
    logger.debug('skipped stale cache write (atomic)', {
      productId: product.id,
      incomingVersion,
    });
    return;
  }

  await runHook('afterCacheSet', { product: toStore });
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
  await redis.set(keys.productsList(), serialize(products),{ EX: config.productCacheTtlSeconds });
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
  await redis.set(keys.productsCategory(category), serialize(products),{ EX: config.productCacheTtlSeconds });
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

async function deleteNegativeCache(id) {
  const redis = await getRedis();
  await redis.del(keys.negativeProduct(id));
}

/**
 * Invalidation is intentionally incomplete in the starter codebase.
 * Mutations should invalidate detail + dependent list keys — not fully wired yet.
 */
async function invalidateProductCaches(_productId, _oldCategory, _newCategory) {
  logger.debug('invalidateProductCaches called (starter implementation is a no-op stub)');
  await flushAllProductCacheKeys(); // TODO(by sanketh thoughts): only flush keys that are affected by the mutation
}

async function flushProductCategoryListCaches(category) {
  const redis = await getRedis();
  const toDelete = [];
  for await (const key of redis.scanIterator({ MATCH: keys.productsCategory(category), COUNT: 100 })) {
    toDelete.push(key);
  }
  if (toDelete.length > 0) await redis.del(toDelete); // TODO: change to delete only the key for the category
}

async function flushProductListCaches() {
  const redis = await getRedis();
  const toDelete = [];
  for await (const key of redis.scanIterator({ MATCH: keys.productsList(), COUNT: 100 })) {
    toDelete.push(key);
  }
  if (toDelete.length > 0) await redis.del(toDelete);
}

async function invalidateProductLists() {
  await flushProductListCaches();
}

async function invalidateCategoryList(category) {
  const redis = await getRedis();
  await redis.del(keys.productsCategory(category));
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
  deserialize,
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
  flushProductCategoryListCaches,
  flushProductListCaches,
  deleteNegativeCache,
  invalidateProductLists,
  invalidateCategoryList,
};
