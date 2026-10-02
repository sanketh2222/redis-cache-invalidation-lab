const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 30,
});

pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('[db] unexpected pool error', err);
});

module.exports = pool;
