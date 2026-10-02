const productService = require('../services/productService');

async function getById(req, res, next) {
  try {
    const product = await productService.getProductById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    return res.json(product);
  } catch (err) {
    return next(err);
  }
}

async function list(req, res, next) {
  try {
    const { category } = req.query;
    const products = category
      ? await productService.listProductsByCategory(String(category))
      : await productService.listProducts();
    return res.json({ products });
  } catch (err) {
    return next(err);
  }
}

async function create(req, res, next) {
  try {
    const { name, description, price, category } = req.body || {};
    if (!name || price == null || !category) {
      return res.status(400).json({ error: 'name, price, and category are required' });
    }
    const product = await productService.createProduct({
      name,
      description: description || '',
      price: Number(price),
      category,
    });
    return res.status(201).json(product);
  } catch (err) {
    return next(err);
  }
}

async function update(req, res, next) {
  try {
    const product = await productService.updateProduct(req.params.id, req.body || {});
    if (!product) return res.status(404).json({ error: 'Product not found' });
    return res.json(product);
  } catch (err) {
    return next(err);
  }
}

async function remove(req, res, next) {
  try {
    const ok = await productService.deleteProduct(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Product not found' });
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
}

module.exports = { getById, list, create, update, remove };
