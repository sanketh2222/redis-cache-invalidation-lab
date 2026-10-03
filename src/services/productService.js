const productRepository = require('../repositories/productRepository');
const cacheService = require('./cacheService');
const logger = require('../logging/logger');

async function getProductById(id) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    const err = new Error('Invalid product id');
    err.status = 400;
    throw err;
  }

  const cached = await cacheService.getCachedProduct(numericId);
  if (cached.hit && cached.product) {
    logger.debug('cache hit for product', { id: numericId });
    return cached.product;
  }

  const result = await cacheService.getNegativeCache(numericId);
  if (result) {
    logger.debug('negative cache hit for product', { id: numericId });
    return null;
  }

  const fromDb = await productRepository.findById(numericId);
  if (!fromDb) {
    logger.debug('negative cache for product', { id: numericId });
    await cacheService.setNegativeCache(numericId);
    return null;
  }

  await cacheService.setCachedProduct(fromDb);
  return fromDb;
}

async function listProducts() {
  const cached = await cacheService.getCachedList();
  if (cached) return cached;

  const products = await productRepository.findAll();
  await cacheService.setCachedList(products);
  return products;
}

async function listProductsByCategory(category) {
  const cached = await cacheService.getCachedCategoryList(category);
  if (cached) return cached;

  const products = await productRepository.findByCategory(category);
  await cacheService.setCachedCategoryList(category, products);
  return products;
}

async function createProduct(payload) {
  const created = await productRepository.create(payload);
  await cacheService.flushProductListCaches();
  return created;
}

async function updateProduct(id, payload) {
  const existing = await productRepository.findById(Number(id));
  if (!existing) return null;

  const updated = await productRepository.update(Number(id), payload);
  await cacheService.invalidateProductCaches(updated.id, existing.category, updated.category);
  return updated;
}

async function deleteProduct(id) {
  const existing = await productRepository.findById(Number(id));
  if (!existing) return false;

  const ok = await productRepository.remove(Number(id));
  if (ok) {
    await cacheService.invalidateProductCaches(existing.id, existing.category, null);
  }
  return ok;
}

module.exports = {
  getProductById,
  listProducts,
  listProductsByCategory,
  createProduct,
  updateProduct,
  deleteProduct,
};
