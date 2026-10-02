const pool = require('../db/pool');
const { incrementDbQueryCount } = require('../testing/dbMetrics');
const { runHook } = require('../testing/cacheHooks');

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: Number(row.price),
    category: row.category,
    updated_at: row.updated_at,
    version: row.version,
  };
}

async function findById(id) {
  await runHook('beforeDbRead', { id, op: 'findById' });
  incrementDbQueryCount();
  const { rows } = await pool.query(
    `SELECT id, name, description, price, category, updated_at, version
     FROM products WHERE id = $1`,
    [id]
  );
  await runHook('afterDbRead', { id, op: 'findById', row: rows[0] || null });
  return mapRow(rows[0]);
}

async function findAll() {
  incrementDbQueryCount();
  const { rows } = await pool.query(
    `SELECT id, name, description, price, category, updated_at, version
     FROM products ORDER BY id ASC`
  );
  return rows.map(mapRow);
}

async function findByCategory(category) {
  incrementDbQueryCount();
  const { rows } = await pool.query(
    `SELECT id, name, description, price, category, updated_at, version
     FROM products WHERE category = $1 ORDER BY id ASC`,
    [category]
  );
  return rows.map(mapRow);
}

async function create(product) {
  incrementDbQueryCount();
  const { rows } = await pool.query(
    `INSERT INTO products (name, description, price, category, version)
     VALUES ($1, $2, $3, $4, 1)
     RETURNING id, name, description, price, category, updated_at, version`,
    [product.name, product.description, product.price, product.category]
  );
  return mapRow(rows[0]);
}

async function update(id, patch) {
  incrementDbQueryCount();
  const { rows } = await pool.query(
    `UPDATE products
     SET name = COALESCE($2, name),
         description = COALESCE($3, description),
         price = COALESCE($4, price),
         category = COALESCE($5, category),
         version = version + 1,
         updated_at = NOW()
     WHERE id = $1
     RETURNING id, name, description, price, category, updated_at, version`,
    [id, patch.name ?? null, patch.description ?? null, patch.price ?? null, patch.category ?? null]
  );
  return mapRow(rows[0]);
}

async function remove(id) {
  incrementDbQueryCount();
  const { rowCount } = await pool.query('DELETE FROM products WHERE id = $1', [id]);
  return rowCount > 0;
}

module.exports = {
  findById,
  findAll,
  findByCategory,
  create,
  update,
  remove,
};
