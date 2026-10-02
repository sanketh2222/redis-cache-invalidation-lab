#!/usr/bin/env node
require('dotenv').config();

process.env.NODE_ENV = 'test';
process.env.ENABLE_CACHE_HOOKS = '1';

const { createApp } = require('../src/app');
const { getRedis, closeRedis } = require('../src/redis/client');
const keys = require('../src/redis/keys');
const cacheService = require('../src/services/cacheService');
const productRepository = require('../src/repositories/productRepository');
const { hooks, resetHooks } = require('../src/testing/cacheHooks');
const { collectRedisStats } = require('../src/metrics/prometheus');
const { runLoad } = require('./load-test');
const config = require('../src/config');
const {
  getDbQueryCount,
  resetDbQueryCount,
} = require('../src/testing/dbMetrics');
const { resetFixtures } = require('./reset-fixtures');

const results = [];

function pass(name, detail) {
  results.push({ name, ok: true, detail });
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, detail) {
  results.push({ name, ok: false, detail });
  console.log(`FAIL  ${name}${detail ? `\n       ${detail}` : ''}`);
}

async function jsonFetch(baseUrl, path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  let body = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { res, body, text };
}

async function resetDebugCounter(baseUrl) {
  await jsonFetch(baseUrl, '/debug/db-query-count/reset', { method: 'POST' });
}

async function getDebugCounter(baseUrl) {
  const { body } = await jsonFetch(baseUrl, '/debug/db-query-count');
  return body.count;
}

function parseMetricValue(metricsText, metricName) {
  const line = metricsText
    .split('\n')
    .find((l) => l.startsWith(`${metricName}{`) || l.startsWith(`${metricName} `));
  if (!line) return null;
  const parts = line.trim().split(/\s+/);
  return Number(parts[parts.length - 1]);
}

async function listenApp() {
  const app = createApp();
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, (err) => (err ? reject(err) : resolve(s)));
  });
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

async function runInfrastructureChecks(baseUrl, redis) {
  let stats;
  try {
    stats = await collectRedisStats(redis);
  } catch (err) {
    fail('Redis memory inspection (final review)', String(err));
  }

  if (!stats) return;

  if (stats.maxMemory > 0) {
    pass('Redis maxmemory limit configured', `${stats.maxMemory} bytes cap`);
  } else {
    fail(
      'Redis maxmemory limit configured',
      'Redis maxmemory is 0 (no limit). Set REDIS_MAXMEMORY in docker compose and restart Redis.'
    );
  }

  pass(
    'Redis memory inspection (final review)',
    `used=${stats.usedMemory} bytes, policy=${stats.maxmemoryPolicy}`
  );

  const target = config.cacheEvictionPolicyTarget.trim();
  if (target && stats.maxmemoryPolicy === target) {
    pass('Redis maxmemory-policy matches your CACHE_EVICTION_POLICY_TARGET');
  } else {
    fail(
      'Redis maxmemory-policy matches your CACHE_EVICTION_POLICY_TARGET',
      target
        ? `Expected policy "${target}", Redis reports "${stats.maxmemoryPolicy}". Align REDIS_MAXMEMORY_POLICY and CACHE_EVICTION_POLICY_TARGET.`
        : 'Set CACHE_EVICTION_POLICY_TARGET in .env to the policy you chose, then match REDIS_MAXMEMORY_POLICY in docker compose.'
    );
  }

  const metricsRes = await jsonFetch(baseUrl, '/metrics');
  if (metricsRes.res.status !== 200 || !metricsRes.text.includes('cache_hits_total')) {
    fail('Prometheus /metrics exposes cache counters', 'GET /metrics missing cache_hits_total');
  } else {
    pass('Prometheus /metrics exposes cache counters');
  }

  if (metricsRes.text.includes('cache_estimated_bytes') && metricsRes.text.includes('redis_memory_used_bytes')) {
    pass('Prometheus /metrics exposes cache-size and Redis memory gauges');
  } else {
    fail(
      'Prometheus /metrics exposes cache-size and Redis memory gauges',
      'Expected cache_estimated_bytes and redis_memory_used_bytes in /metrics output'
    );
  }

  await cacheService.flushAllProductCacheKeys();
  await jsonFetch(baseUrl, '/products/1');
  await jsonFetch(baseUrl, '/products/1');
  await jsonFetch(baseUrl, '/products/1');
  const metricsAfter = await jsonFetch(baseUrl, '/metrics');
  const hits = parseMetricValue(metricsAfter.text, 'cache_hits_total');
  const misses = parseMetricValue(metricsAfter.text, 'cache_misses_total');
  const ratio = parseMetricValue(metricsAfter.text, 'cache_hit_ratio');
  if (hits >= 2 && misses >= 1 && ratio >= 0.5) {
    pass('Cache hit ratio measurable via metrics', `ratio=${ratio}, hits=${hits}, misses=${misses}`);
  } else {
    fail(
      'Cache hit ratio measurable via metrics',
      `Expected hits>=2 misses>=1 ratio>=0.5; got hits=${hits} misses=${misses} ratio=${ratio}`
    );
  }

  process.env.CACHE_WARM_PRODUCT_IDS = '1,2';
  const warm = await jsonFetch(baseUrl, '/admin/cache/warm', { method: 'POST' });
  if (warm.res.status === 200 && warm.body && warm.body.warmed && warm.body.warmed.length >= 1) {
    pass('Configured cache warming populates Redis');
  } else {
    fail(
      'Configured cache warming populates Redis',
      `POST /admin/cache/warm with CACHE_WARM_PRODUCT_IDS=1,2 should warm keys (implement cacheWarmer). Status=${warm.res.status} detail=${warm.body?.detail || warm.body?.reason || 'n/a'}`
    );
  }

  const load = await runLoad({
    url: baseUrl,
    path: '/products/1',
    requests: 60,
    concurrency: 10,
  });
  if (load.p50 > 0 && load.p95 > 0 && load.p99 > 0) {
    pass(
      'Load test latency percentiles (P50/P95/P99)',
      `P50=${load.p50.toFixed(2)}ms P95=${load.p95.toFixed(2)}ms P99=${load.p99.toFixed(2)}ms errors=${load.errors}`
    );
  } else {
    fail('Load test latency percentiles (P50/P95/P99)', 'load-test.js did not produce percentile data');
  }
}

async function runSharedCacheCheck(baseUrlA, baseUrlB) {
  await cacheService.flushAllProductCacheKeys();
  await jsonFetch(baseUrlA, '/products/2');
  await resetDebugCounter(baseUrlB);
  resetDbQueryCount();
  await jsonFetch(baseUrlB, '/products/2');
  const db = await getDebugCounter(baseUrlB);
  if (db === 0) {
    pass('Shared Redis cache across two API instances');
  } else {
    fail(
      'Shared Redis cache across two API instances',
      `Second instance should hit shared Redis (0 DB queries). Got ${db} DB queries on instance B.`
    );
  }
}

async function runChecks(baseUrl, redis) {
  try {
    await redis.ping();
    pass('Redis connection');
  } catch (err) {
    fail('Redis connection', String(err));
    return;
  }

  await runInfrastructureChecks(baseUrl, redis);

  await cacheService.flushAllProductCacheKeys();
  await resetDebugCounter(baseUrl);

  await jsonFetch(baseUrl, '/products/1');
  resetDbQueryCount();
  await resetDebugCounter(baseUrl);
  const { body: hitBody } = await jsonFetch(baseUrl, '/products/1');
  const dbAfterHit = await getDebugCounter(baseUrl);
  if (hitBody && hitBody.id === 1 && dbAfterHit === 0) {
    pass('Cache hit avoids DB');
  } else {
    fail('Cache hit avoids DB', `Expected 0 DB queries on second GET /products/1, got ${dbAfterHit}`);
  }

  await cacheService.flushAllProductCacheKeys();
  resetDbQueryCount();
  await resetDebugCounter(baseUrl);
  const { body: missBody } = await jsonFetch(baseUrl, '/products/1');
  const dbAfterMiss = await getDebugCounter(baseUrl);
  const cached = await redis.get(keys.product(1));
  if (missBody && missBody.id === 1 && dbAfterMiss >= 1 && cached) {
    pass('Cache miss loads DB and populates Redis');
  } else {
    fail(
      'Cache miss loads DB and populates Redis',
      `DB queries=${dbAfterMiss}, redis key present=${Boolean(cached)}`
    );
  }

  await cacheService.flushAllProductCacheKeys();
  await jsonFetch(baseUrl, '/products/1');
  const putRes = await jsonFetch(baseUrl, '/products/1', {
    method: 'PUT',
    body: JSON.stringify({ name: `Eval Rename ${Date.now()}` }),
  });
  const afterPutGet = await jsonFetch(baseUrl, '/products/1');
  const rawAfterPut = await redis.get(keys.product(1));
  const parsed = rawAfterPut ? JSON.parse(rawAfterPut) : null;

  if (putRes.res.status === 200 && putRes.body && putRes.body.name) {
    pass('PUT returns fresh product data');
  } else {
    fail('PUT returns fresh product data', `Unexpected PUT status/body: ${putRes.res.status}`);
  }

  if (
    afterPutGet.body &&
    putRes.body &&
    afterPutGet.body.name === putRes.body.name &&
    afterPutGet.body.version === putRes.body.version
  ) {
    pass('GET after PUT serves updated product (not stale cache)');
  } else {
    fail(
      'GET after PUT serves updated product (not stale cache)',
      `Expected GET name=${putRes.body.name} version=${putRes.body.version}\n       Actual GET name=${afterPutGet.body?.name} version=${afterPutGet.body?.version}`
    );
  }

  if (
    parsed &&
    putRes.body &&
    parsed.name === putRes.body.name &&
    parsed.version === putRes.body.version
  ) {
    pass('Detail cache matches database after PUT');
  } else {
    fail(
      'Detail cache matches database after PUT',
      `Expected Redis product:1 name=${putRes.body?.name} version=${putRes.body?.version}\n       Actual: ${parsed ? `name=${parsed.name} version=${parsed.version}` : 'missing key'}`
    );
  }

  await cacheService.flushAllProductCacheKeys();
  await jsonFetch(baseUrl, '/products');
  const listBefore = await jsonFetch(baseUrl, '/products/1');
  const putList = await jsonFetch(baseUrl, '/products/1', {
    method: 'PUT',
    body: JSON.stringify({ price: Number(listBefore.body.price) + 1 }),
  });
  const listRes = await jsonFetch(baseUrl, '/products');
  const listItem = (listRes.body.products || []).find((p) => p.id === 1);
  if (listItem && putList.body && listItem.price === putList.body.price) {
    pass('List cache invalidation after PUT');
  } else {
    fail(
      'List cache invalidation after PUT',
      `Expected products:list price for id=1 to match PUT result (${putList.body?.price}).\n       Actual list price=${listItem ? listItem.price : 'missing'}`
    );
  }

  await cacheService.flushAllProductCacheKeys();
  await jsonFetch(baseUrl, '/products/1');
  const ttl = await redis.ttl(keys.product(1));
  if (ttl > 0 && ttl <= 120) {
    pass('TTL on product detail cache');
  } else {
    fail('TTL on product detail cache', `Expected positive TTL on product:1, got ${ttl}`);
  }

  await jsonFetch(baseUrl, '/products');
  const listTtlAfter = await redis.ttl(keys.productsList());
  if (listTtlAfter > 0) {
    pass('TTL on list cache');
  } else {
    fail(
      'TTL on list cache',
      `Expected positive TTL on products:list after GET /products, got ${listTtlAfter}`
    );
  }

  await cacheService.flushAllProductCacheKeys();
  resetDbQueryCount();
  await resetDebugCounter(baseUrl);
  await jsonFetch(baseUrl, '/products/99999');
  const db1 = await getDebugCounter(baseUrl);
  resetDbQueryCount();
  await resetDebugCounter(baseUrl);
  await jsonFetch(baseUrl, '/products/99999');
  const db2 = await getDebugCounter(baseUrl);
  const negKey = await redis.exists(keys.negativeProduct(99999));
  if (db1 >= 1 && db2 === 0 && negKey) {
    pass('Negative caching for missing products');
  } else {
    fail(
      'Negative caching for missing products',
      `Expected second GET to avoid DB (db2=0) with negative key set. db1=${db1}, db2=${db2}, negativeKey=${negKey}`
    );
  }

  await cacheService.flushAllProductCacheKeys();
  resetDbQueryCount();
  await resetDebugCounter(baseUrl);
  const stampedeId = 2;
  await Promise.all(
    Array.from({ length: 25 }, () => jsonFetch(baseUrl, `/products/${stampedeId}`))
  );
  const stampedeDb = await getDebugCounter(baseUrl);
  if (stampedeDb <= 3) {
    pass('Concurrent request protection (stampede)');
  } else {
    fail(
      'Concurrent request protection (stampede)',
      `25 parallel cache misses for product:${stampedeId} caused ${stampedeDb} DB queries (expected coalescing to a small number)`
    );
  }

  resetHooks();
  await cacheService.flushAllProductCacheKeys();
  const productId = 1;
  let releaseA;
  const gate = new Promise((resolve) => {
    releaseA = resolve;
  });
  hooks.afterDbRead = async (ctx) => {
    if (ctx.op === 'findById' && ctx.id === productId) {
      await gate;
    }
  };

  const slowGet = jsonFetch(baseUrl, `/products/${productId}`);
  let bumped;
  try {
    await new Promise((r) => setTimeout(r, 50));
    bumped = await productRepository.update(productId, {
      name: `Race Winner ${Date.now()}`,
    });
    await cacheService.setCachedProduct(bumped);
    releaseA();
    await slowGet;
  } finally {
    releaseA();
    resetHooks();
  }

  const rawRace = await redis.get(keys.product(productId));
  const parsedRace = rawRace ? JSON.parse(rawRace) : null;
  if (parsedRace && bumped && parsedRace.version >= bumped.version) {
    pass('Stale cache write protection (simulated dual-write)');
  } else {
    fail(
      'Stale cache write protection (simulated dual-write)',
      `Simulated race (see docs/stage7-dual-write-simulation.md): expected Redis product:${productId} version >= ${bumped?.version}\n       Actual: ${parsedRace ? `version ${parsedRace.version}` : 'missing'}`
    );
  }
}

async function main() {
  let serverA;
  let serverB;
  try {
    await resetFixtures();
    await getRedis();
    await cacheService.flushAllProductCacheKeys();

    const a = await listenApp();
    serverA = a.server;
    const b = await listenApp();
    serverB = b.server;

    console.log(`Evaluator instance A: ${a.baseUrl}`);
    console.log(`Evaluator instance B: ${b.baseUrl}\n`);

    await runSharedCacheCheck(a.baseUrl, b.baseUrl);
    await runChecks(a.baseUrl, await getRedis());
  } catch (err) {
    fail('Evaluator startup', String(err));
  } finally {
    if (serverA) await new Promise((resolve) => serverA.close(resolve));
    if (serverB) await new Promise((resolve) => serverB.close(resolve));
    await closeRedis();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main();
