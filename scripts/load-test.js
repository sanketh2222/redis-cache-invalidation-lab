#!/usr/bin/env node
/**
 * Lightweight load test — reports latency percentiles (P50, P95, P99).
 *
 * Usage:
 *   node scripts/load-test.js --url http://localhost:3000 --path /products/1 --requests 200 --concurrency 20
 */

function parseArgs(argv) {
  const args = {
    url: 'http://localhost:3000',
    path: '/products/1',
    requests: 100,
    concurrency: 10,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const val = argv[i + 1];
    if (key === '--url' && val) args.url = val;
    if (key === '--path' && val) args.path = val;
    if (key === '--requests' && val) args.requests = Number(val);
    if (key === '--concurrency' && val) args.concurrency = Number(val);
  }
  return args;
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

async function runOne(baseUrl, path) {
  const start = performance.now();
  const res = await fetch(`${baseUrl}${path}`);
  await res.arrayBuffer();
  const ms = performance.now() - start;
  return { ms, ok: res.ok, status: res.status };
}

async function runLoad({ url, path, requests, concurrency }) {
  const latencies = [];
  let errors = 0;
  let next = 0;

  async function worker() {
    while (true) {
      const i = next;
      next += 1;
      if (i >= requests) return;
      try {
        const { ms, ok } = await runOne(url, path);
        latencies.push(ms);
        if (!ok) errors += 1;
      } catch {
        errors += 1;
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  latencies.sort((a, b) => a - b);

  return {
    requests,
    concurrency,
    errors,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
    min: latencies[0] || 0,
    max: latencies[latencies.length - 1] || 0,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const result = await runLoad(args);
  console.log(JSON.stringify({ ...result, url: args.url, path: args.path }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { runLoad, percentile };
