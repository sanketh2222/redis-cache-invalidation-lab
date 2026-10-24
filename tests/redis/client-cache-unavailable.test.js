function loadClientWithMockRedis(mockClientFactory) {
  jest.resetModules();
  jest.doMock('redis', () => ({
    createClient: jest.fn(mockClientFactory),
  }));
  const client = require('../../src/redis/client');
  const CacheUnavailableError = require('../../src/errors/CacheUnavailableError');
  return { ...client, CacheUnavailableError };
}

describe('redis client CacheUnavailableError mapping', () => {
  afterEach(async () => {
    jest.resetModules();
    jest.dontMock('redis');
    try {
      const { closeRedis } = require('../../src/redis/client');
      await closeRedis();
    } catch {
      // module may be mocked
    }
  });

  test('command rejection is mapped to CacheUnavailableError with cause', async () => {
    const underlying = new Error('ECONNREFUSED');
    const { getRedis, CacheUnavailableError } = loadClientWithMockRedis(() => ({
      on: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockRejectedValue(underlying),
    }));

    const client = await getRedis();
    await expect(client.get('key')).rejects.toBeInstanceOf(CacheUnavailableError);
    await expect(client.get('key')).rejects.toMatchObject({
      message: 'ECONNREFUSED',
      cause: underlying,
    });
  });

  test('connect failure is mapped to CacheUnavailableError', async () => {
    const underlying = new Error('connect timed out');
    const { getRedis, CacheUnavailableError } = loadClientWithMockRedis(() => ({
      on: jest.fn(),
      connect: jest.fn().mockRejectedValue(underlying),
    }));

    await expect(getRedis()).rejects.toBeInstanceOf(CacheUnavailableError);
    await expect(getRedis()).rejects.toMatchObject({
      message: 'connect timed out',
      cause: underlying,
    });
  });

  test('CacheUnavailableError is not double-wrapped', async () => {
    const mockGet = jest.fn();
    const { getRedis, CacheUnavailableError } = loadClientWithMockRedis(() => ({
      on: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockResolvedValue(undefined),
      get: mockGet,
    }));

    const original = new CacheUnavailableError('already classified');
    mockGet.mockRejectedValue(original);

    const client = await getRedis();
    await expect(client.get('key')).rejects.toBe(original);
  });
});
