const pool = require('../../src/db/pool');
const logger = require('../../src/logging/logger');
const cacheService = require('../../src/services/cacheService');
const { startTestServer, stopTestServer } = require('../helpers/testApp');

describe('create cache failure handling', () => {
  let baseUrl;

  beforeAll(async () => {
    ({ baseUrl } = await startTestServer());
  });

  afterAll(async () => {
    await stopTestServer();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('returns 201 and logs when cache invalidation fails after DB commit', async () => {
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    jest
      .spyOn(cacheService, 'invalidateProductLists')
      .mockRejectedValueOnce(new Error('simulated redis failure'));

    const name = `Cache fail create ${Date.now()}`;
    const res = await fetch(`${baseUrl}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        description: 'cache fail',
        price: 12,
        category: 'electronics',
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe(name);

    const { rows } = await pool.query('SELECT id FROM products WHERE name = $1', [name]);
    expect(rows.length).toBe(1);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ productId: body.id }),
      'Cache invalidation failed after product creation'
    );
  });
});
