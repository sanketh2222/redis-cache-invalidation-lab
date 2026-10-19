const productRepository = require('../repositories/productRepository');
const cacheService = require('./cacheService');
const { getWithSingleFlight } = require('./singleFlight');
const logger = require('../logging/logger');

async function getProductById(id) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    const err = new Error('Invalid product id');
    err.status = 400;
    throw err;
  }

  return getWithSingleFlight(numericId);
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

  try {
    
    await cacheService.deleteNegativeCache(created.id);

    await cacheService.invalidateProductLists();
    await cacheService.invalidateCategoryList(created.category);
    
    await cacheService.setCachedProduct(created);

  } catch (error) {
    logger.error({
      err: error,
      productId: created.id,
      category: created.category
    }, 'Cache invalidation failed after product creation');
  }

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
