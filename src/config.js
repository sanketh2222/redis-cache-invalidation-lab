require('dotenv').config();

const config = {
  port: Number(process.env.PORT || 3000),
  get instanceId() {
    return process.env.INSTANCE_ID || 'api-local';
  },
  get databaseUrl() {
    return (
      process.env.DATABASE_URL ||
      'postgresql://app:appsecret@localhost:5433/products_practice'
    );
  },
  get redisUrl() {
    return process.env.REDIS_URL || 'redis://localhost:6380';
  },
  productCacheTtlSeconds: Number(process.env.PRODUCT_CACHE_TTL_SECONDS || 60),
  negativeCacheTtlSeconds: Number(process.env.NEGATIVE_CACHE_TTL_SECONDS || 30),
  logLevel: process.env.LOG_LEVEL || 'info',
  get cacheWarmOnStartup() {
    return process.env.CACHE_WARM_ON_STARTUP === '1';
  },
  get cacheWarmProductIds() {
    return process.env.CACHE_WARM_PRODUCT_IDS || '';
  },
  get cacheEvictionPolicyTarget() {
    return process.env.CACHE_EVICTION_POLICY_TARGET || '';
  },
};

module.exports = config;
