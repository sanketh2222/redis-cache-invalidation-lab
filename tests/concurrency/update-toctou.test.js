const { startTestServer, stopTestServer } = require('../helpers/testApp');
const cacheService = require('../../src/services/cacheService');
const { hooks, resetHooks } = require('../../src/testing/cacheHooks');

describe('update TOCTOU', () => {
  let baseUrl;

  beforeAll(async () => {
    ({ baseUrl } = await startTestServer());
  });

  afterAll(async () => {
    resetHooks();
    await stopTestServer();
  }, 60000);

  beforeEach(async () => {
    resetHooks();
    await cacheService.flushAllProductCacheKeys();
  });

  test('PUT after DELETE returns 404 not 500', async () => {
    const postRes = await fetch(`${baseUrl}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `TOCTOU ${Date.now()}`,
        description: 'temp',
        price: 2,
        category: 'temp-toctou',
      }),
    });
    const product = await postRes.json();

    const del = await fetch(`${baseUrl}/products/${product.id}`, { method: 'DELETE' });
    expect(del.status).toBe(204);

    const put = await fetch(`${baseUrl}/products/${product.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'should-not-exist' }),
    });

    expect(put.status).toBe(404);
  });

  test.failing(
    'PUT that loaded row then loses it to DELETE should return 404 not 500',
    async () => {
      const postRes = await fetch(`${baseUrl}/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `TOCTOU race ${Date.now()}`,
          description: 'temp',
          price: 2,
          category: 'temp-toctou-race',
        }),
      });
      const product = await postRes.json();

      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      let holdPutRead = false;

      hooks.afterDbRead = async (ctx) => {
        if (holdPutRead) return;
        if (ctx.op === 'findById' && ctx.id === product.id && ctx.row) {
          holdPutRead = true;
          await gate;
        }
      };

      try {
        const slowPut = fetch(`${baseUrl}/products/${product.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'race-update' }),
        });

        await new Promise((r) => setTimeout(r, 50));

        const del = await fetch(`${baseUrl}/products/${product.id}`, { method: 'DELETE' });
        expect(del.status).toBe(204);

        release();
        const put = await slowPut;
        expect(put.status).toBe(404);
      } finally {
        if (release) release();
      }
    },
    60000
  );
});
