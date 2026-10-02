/**
 * Redis key conventions for the product catalog cache.
 * See README.md and docs/redis-practice.md for manual inspection exercises.
 */
const keys = {
  product: (id) => `product:${id}`,
  productsList: () => 'products:list',
  productsCategory: (category) => `products:category:${category}`,
  negativeProduct: (id) => `product:missing:${id}`,
  dbQueryCounter: () => 'metrics:db_queries',
  cacheHits: () => 'metrics:cache_hits',
  cacheMisses: () => 'metrics:cache_misses',
};

module.exports = keys;
