const { startTestServer, stopTestServer } = require('../helpers/testApp');

describe('/metrics', () => {
  let baseUrl;

  beforeAll(async () => {
    ({ baseUrl } = await startTestServer());
  });

  afterAll(async () => {
    await stopTestServer();
  });

  test('returns Prometheus text with cache counters', async () => {
    await fetch(`${baseUrl}/products/1`);
    const res = await fetch(`${baseUrl}/metrics`);
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).toContain('cache_hits_total');
    expect(text).toContain('cache_misses_total');
    expect(text).toContain('redis_memory_used_bytes');
  });
});
