const config = require('../config');

const counters = {
  cache_hits_total: 0,
  cache_misses_total: 0,
  cache_list_hits_total: 0,
  cache_list_misses_total: 0,
};

function instanceLabel() {
  return config.instanceId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function incrementCacheHit() {
  counters.cache_hits_total += 1;
}

function incrementCacheMiss() {
  counters.cache_misses_total += 1;
}

function incrementListHit() {
  counters.cache_list_hits_total += 1;
}

function incrementListMiss() {
  counters.cache_list_misses_total += 1;
}

function resetMetricsForTests() {
  counters.cache_hits_total = 0;
  counters.cache_misses_total = 0;
  counters.cache_list_hits_total = 0;
  counters.cache_list_misses_total = 0;
}

function hitRatio() {
  const hits = counters.cache_hits_total;
  const misses = counters.cache_misses_total;
  const total = hits + misses;
  if (total === 0) return 0;
  return hits / total;
}

async function collectRedisStats(redis) {
  const info = await redis.info('memory');
  const lines = info.split('\r\n');
  const map = {};
  for (const line of lines) {
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    map[line.slice(0, idx)] = line.slice(idx + 1);
  }

  let cacheKeyCount = 0;
  let cacheBytesEstimate = 0;
  const seen = new Set();
  for (const pattern of ['product:*', 'products:*']) {
    for await (const key of redis.scanIterator({ MATCH: pattern, COUNT: 200 })) {
      if (seen.has(key) || key.startsWith('metrics:')) continue;
      seen.add(key);
      cacheKeyCount += 1;
      try {
        cacheBytesEstimate += await redis.strLen(key);
      } catch {
        // ignore non-string keys
      }
    }
  }

  const usedMemory = Number(map.used_memory || 0);
  const maxMemory = Number(map.maxmemory || 0);
  const policyLine = await redis.configGet('maxmemory-policy');
  const maxmemoryPolicy = policyLine['maxmemory-policy'] || 'unknown';

  return {
    usedMemory,
    maxMemory,
    maxmemoryPolicy,
    cacheKeyCount,
    cacheBytesEstimate,
  };
}

async function renderMetrics(redis) {
  const stats = await collectRedisStats(redis);
  const inst = instanceLabel();
  const ratio = hitRatio();

  return `# HELP cache_hits_total Product detail cache hits on this API instance.
# TYPE cache_hits_total counter
cache_hits_total{instance="${inst}"} ${counters.cache_hits_total}
# HELP cache_misses_total Product detail cache misses on this API instance.
# TYPE cache_misses_total counter
cache_misses_total{instance="${inst}"} ${counters.cache_misses_total}
# HELP cache_list_hits_total List/category cache hits on this API instance.
# TYPE cache_list_hits_total counter
cache_list_hits_total{instance="${inst}"} ${counters.cache_list_hits_total}
# HELP cache_list_misses_total List/category cache misses on this API instance.
# TYPE cache_list_misses_total counter
cache_list_misses_total{instance="${inst}"} ${counters.cache_list_misses_total}
# HELP cache_hit_ratio Product detail hit ratio (hits / (hits + misses)) on this instance.
# TYPE cache_hit_ratio gauge
cache_hit_ratio{instance="${inst}"} ${ratio.toFixed(6)}
# HELP cache_keys_count Approximate count of product/products* cache keys in Redis.
# TYPE cache_keys_count gauge
cache_keys_count{instance="${inst}"} ${stats.cacheKeyCount}
# HELP cache_estimated_bytes Sum of STRLEN for scanned product/products* keys (approximate).
# TYPE cache_estimated_bytes gauge
cache_estimated_bytes{instance="${inst}"} ${stats.cacheBytesEstimate}
# HELP redis_memory_used_bytes Redis used_memory from INFO memory.
# TYPE redis_memory_used_bytes gauge
redis_memory_used_bytes{instance="${inst}"} ${stats.usedMemory}
# HELP redis_memory_max_bytes Redis maxmemory configuration (0 means no hard limit).
# TYPE redis_memory_max_bytes gauge
redis_memory_max_bytes{instance="${inst}"} ${stats.maxMemory}
# HELP redis_maxmemory_policy Configured Redis maxmemory-policy.
# TYPE redis_maxmemory_policy gauge
redis_maxmemory_policy_info{instance="${inst}",policy="${stats.maxmemoryPolicy}"} 1
`;
}

module.exports = {
  incrementCacheHit,
  incrementCacheMiss,
  incrementListHit,
  incrementListMiss,
  resetMetricsForTests,
  hitRatio,
  collectRedisStats,
  renderMetrics,
};
