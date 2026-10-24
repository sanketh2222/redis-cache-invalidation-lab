const { createClient } = require('redis');
const config = require('../config');
const logger = require('../logging/logger');
const CacheUnavailableError = require('../errors/CacheUnavailableError');

let client;
let wrappedClient;
let connected = false;

function toCacheUnavailable(err) {
  if (err instanceof CacheUnavailableError) return err;
  return new CacheUnavailableError(err.message, { cause: err });
}

async function guardRedis(promise) {
  const timeoutMs = config.redisCommandTimeoutMs;
  let timer;
  const timeout =
    timeoutMs > 0
      ? new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Redis command timed out after ${timeoutMs}ms`)),
            timeoutMs,
          );
        })
      : null;

  try {
    if (timeout) {
      return await Promise.race([promise, timeout]);
    }
    return await promise;
  } catch (err) {
    throw toCacheUnavailable(err);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function wrapMulti(multi) {
  return new Proxy(multi, {
    get(target, prop) {
      const value = target[prop];
      if (prop === 'exec' && typeof value === 'function') {
        return (...args) => guardRedis(Reflect.apply(value, target, args));
      }
      if (typeof value === 'function') {
        return (...args) => Reflect.apply(value, target, args);
      }
      return value;
    },
  });
}

function wrapScanIterator(source) {
  async function* iterate() {
    try {
      for await (const item of source) {
        yield item;
      }
    } catch (err) {
      throw toCacheUnavailable(err);
    }
  }
  return iterate();
}

function wrapRedisClient(raw) {
  return new Proxy(raw, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;

      if (prop === 'multi') {
        return (...args) => wrapMulti(Reflect.apply(value, target, args));
      }
      if (prop === 'scanIterator') {
        return (...args) => wrapScanIterator(Reflect.apply(value, target, args));
      }

      return (...args) => guardRedis(Reflect.apply(value, target, args));
    },
  });
}

async function getRedis() {
  if (wrappedClient) return wrappedClient;
  client = createClient({
    url: config.redisUrl,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: config.redisConnectTimeoutMs,
    },
  });
  client.on('error', (err) => logger.error('redis client error', { err: String(err) }));
  try {
    await client.connect();
  } catch (err) {
    client = null;
    throw toCacheUnavailable(err);
  }
  connected = true;
  wrappedClient = wrapRedisClient(client);
  return wrappedClient;
}

function isRedisConnected() {
  return connected;
}

async function closeRedis() {
  if (client && connected) {
    await client.quit();
    connected = false;
    client = null;
    wrappedClient = null;
  }
}

module.exports = { getRedis, closeRedis, isRedisConnected };
