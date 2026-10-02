require('dotenv').config();

process.env.NODE_ENV = 'test';
process.env.ENABLE_CACHE_HOOKS = '1';

const { resetFixtures } = require('../scripts/reset-fixtures');

beforeAll(async () => {
  await resetFixtures();
});
