const crypto = require('crypto');
const { getRedis } = require('./client');

/** Half of typical 60s gateway timeout; safety ceiling, not expected DB duration. */
const LOCK_TTL_MS = 30_000;

/**
 * Plain GET then DEL is unsafe: the lock can expire and another holder can acquire
 * between GET and DEL, so DEL would remove the new owner's lock.
 */
const RELEASE_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

function lockKey(id) {
  return `lock:product:${id}`;
}

function productsListLockKey() {
  return 'lock:products:list';
}

function categoryListLockKey(category) {
  return `lock:products:category:${category}`;
}

async function acquireLockForKey(key, ttlMs = LOCK_TTL_MS) {
  const redis = await getRedis();
  const token = crypto.randomUUID();
  const ok = await redis.set(key, token, { NX: true, PX: ttlMs });
  return ok ? token : null;
}

async function releaseLockForKey(key, token) {
  if (!token) return;
  const redis = await getRedis();
  await redis.eval(RELEASE_LOCK_SCRIPT, {
    keys: [key],
    arguments: [token],
  });
}

async function acquireLock(id, ttlMs = LOCK_TTL_MS) {
  return acquireLockForKey(lockKey(id), ttlMs);
}

async function releaseLock(id, token) {
  return releaseLockForKey(lockKey(id), token);
}

module.exports = {
  LOCK_TTL_MS,
  lockKey,
  productsListLockKey,
  categoryListLockKey,
  acquireLock,
  releaseLock,
  acquireLockForKey,
  releaseLockForKey,
};
