require('dotenv').config();
const pool = require('../src/db/pool');

const seedProducts = [
  {
    name: 'Wireless Mouse',
    description: 'Ergonomic wireless mouse',
    price: 29.99,
    category: 'electronics',
  },
  {
    name: 'Mechanical Keyboard',
    description: 'Tactile switches, RGB backlight',
    price: 89.5,
    category: 'electronics',
  },
  {
    name: 'Desk Lamp',
    description: 'Adjustable LED desk lamp',
    price: 45.0,
    category: 'home',
  },
  {
    name: 'Notebook Set',
    description: 'Pack of 3 ruled notebooks',
    price: 12.25,
    category: 'stationery',
  },
];

async function seed() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM products');
  if (rows[0].count > 0) {
    // eslint-disable-next-line no-console
    console.log(`Seed skipped (${rows[0].count} products already present).`);
    await pool.end();
    return;
  }

  for (const p of seedProducts) {
    await pool.query(
      `INSERT INTO products (name, description, price, category, version)
       VALUES ($1, $2, $3, $4, 1)`,
      [p.name, p.description, p.price, p.category]
    );
  }
  // eslint-disable-next-line no-console
  console.log(`Seeded ${seedProducts.length} products.`);
  await pool.end();
}

seed().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
