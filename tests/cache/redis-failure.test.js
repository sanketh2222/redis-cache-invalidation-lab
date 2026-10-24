const config = require('../../src/config');

describe('redis client fail-fast options', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('redis');
  });

  test('createClient receives disableOfflineQueue and socket.connectTimeout', async () => {
    let capturedOpts;

    await new Promise((resolve, reject) => {
      jest.isolateModules(() => {
        jest.doMock('redis', () => ({
          createClient: jest.fn((opts) => {
            capturedOpts = opts;
            return {
              on: jest.fn(),
              connect: jest.fn().mockResolvedValue(undefined),
              quit: jest.fn().mockResolvedValue(undefined),
            };
          }),
        }));
        const { getRedis, closeRedis } = require('../../src/redis/client');
        getRedis()
          .then(() => closeRedis())
          .then(resolve)
          .catch(reject);
      });
    });

    expect(capturedOpts.disableOfflineQueue).toBe(true);
    expect(capturedOpts.socket.connectTimeout).toBe(config.redisConnectTimeoutMs);
  });
});
