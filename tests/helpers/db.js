const pool = require('../../src/db/pool');

async function nextProductId() {
  const { rows } = await pool.query('SELECT COALESCE(MAX(id), 0) + 1 AS next FROM products');
  return rows[0].next;
}

module.exports = { nextProductId };
