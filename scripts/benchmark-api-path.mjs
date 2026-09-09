#!/usr/bin/env node

/**
 * Read-only client-path benchmark runner for the protected Nazraa canary APIs.
 *
 * It intentionally sends a fresh request for every sample, does not retry failed
 * commands, and prints only aggregate timings/statuses. The benchmark key stays
 * in the process environment and is never written to stdout/stderr.
 *
 * Examples:
 *   NAZRAA_BENCHMARK_KEY=… node scripts/benchmark-api-path.mjs \
 *     --base-url https://nazraa.vercel.app --path /api/internal/performance-benchmark
 *   NAZRAA_BENCHMARK_KEY=… node scripts/benchmark-api-path.mjs \
 *     --base-url https://api-benchmark.pixtra.site --path /benchmark --concurrency 10
 */

import { performance } from 'node:perf_hooks';

const defaults = {
  baseUrl: '',
  path: '/api/internal/performance-benchmark',
  samples: 30,
  concurrency: 1,
  timeoutMs: 30_000,
  operations: [
    'room-bootstrap',
    'room-block',
    'profile',
    'game-bet-validation',
    'discover',
    'gift-preparation',
    'verification-finalization',
  ],
};

function readArgs(argv) {
  const settings = { ...defaults };
  for (let index = 2; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag.startsWith('--') || value === undefined) continue;
    if (flag === '--base-url') settings.baseUrl = value;
    if (flag === '--path') settings.path = value;
    if (flag === '--samples') settings.samples = Number(value);
    if (flag === '--concurrency') settings.concurrency = Number(value);
    if (flag === '--timeout-ms') settings.timeoutMs = Number(value);
    if (flag === '--operations') settings.operations = value.split(',').map((item) => item.trim()).filter(Boolean);
    index += 1;
  }

  if (!settings.baseUrl || !Number.isInteger(settings.samples) || settings.samples < 1 ||
      !Number.isInteger(settings.concurrency) || settings.concurrency < 1 ||
      !Number.isInteger(settings.timeoutMs) || settings.timeoutMs < 1 || !settings.operations.length) {
    throw new Error('Invalid benchmark options. Provide --base-url and positive samples/concurrency/timeout values.');
  }
  return settings;
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = Math.ceil(sorted.length * fraction) - 1;
  return Number(sorted[Math.max(0, Math.min(position, sorted.length - 1))].toFixed(2));
}

function distribution(values) {
  return {
    count: values.length,
    p50Ms: percentile(values, 0.50),
    p90Ms: percentile(values, 0.90),
    p95Ms: percentile(values, 0.95),
    p99Ms: percentile(values, 0.99),
    minMs: values.length ? Number(Math.min(...values).toFixed(2)) : null,
    maxMs: values.length ? Number(Math.max(...values).toFixed(2)) : null,
  };
}

async function requestSample({ endpoint, key, operation, timeoutMs }) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const startedAt = performance.now();
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-nazraa-benchmark-key': key,
        // Avoid an intermediary response-cache hit concealing origin timing.
        'cache-control': 'no-cache',
      },
      body: JSON.stringify({ operation }),
      signal: timeout,
    });
    const clientTotalMs = performance.now() - startedAt;
    let result = null;
    try {
      result = await response.json();
    } catch {
      // A malformed/non-JSON response is recorded as an error without printing it.
    }
    const serverTotalMs = Number(result?.timings?.totalMs ?? result?.totalMs);
    const dbAcquireMs = Number(result?.timings?.dbAcquireMs ?? result?.dbAcquireMs);
    const sqlMs = Number(result?.timings?.sqlMs ?? result?.sqlMs ?? result?.dbQueryAggregateMs);
    const appMs = Number(result?.timings?.appMs ?? result?.appMs);
    return {
      ok: response.ok && Number.isFinite(serverTotalMs),
      status: response.status,
      clientTotalMs,
      serverTotalMs: Number.isFinite(serverTotalMs) ? serverTotalMs : null,
      dbAcquireMs: Number.isFinite(dbAcquireMs) ? dbAcquireMs : null,
      sqlMs: Number.isFinite(sqlMs) ? sqlMs : null,
      appMs: Number.isFinite(appMs) ? appMs : null,
      error: response.ok ? (Number.isFinite(serverTotalMs) ? null : 'invalid_benchmark_response') : 'http_error',
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      clientTotalMs: performance.now() - startedAt,
      serverTotalMs: null,
      dbAcquireMs: null,
      sqlMs: null,
      appMs: null,
      error: error?.name === 'TimeoutError' ? 'timeout' : 'network_error',
    };
  }
}

async function runOperation(settings, endpoint, key, operation) {
  const samples = [];
  let cursor = 0;
  async function worker() {
    while (cursor < settings.samples) {
      cursor += 1;
      samples.push(await requestSample({ endpoint, key, operation, timeoutMs: settings.timeoutMs }));
    }
  }
  await Promise.all(Array.from({ length: Math.min(settings.concurrency, settings.samples) }, worker));
  const successful = samples.filter((sample) => sample.ok);
  const failures = samples.filter((sample) => !sample.ok);
  return {
    samples: settings.samples,
    successful: successful.length,
    failed: failures.length,
    statusCounts: Object.fromEntries([...new Set(samples.map((sample) => String(sample.status ?? 'network')))]
      .map((status) => [status, samples.filter((sample) => String(sample.status ?? 'network') === status).length])),
    errorCounts: Object.fromEntries([...new Set(failures.map((sample) => sample.error))]
      .map((error) => [error, failures.filter((sample) => sample.error === error).length])),
    clientTotal: distribution(successful.map((sample) => sample.clientTotalMs)),
    serverTotal: distribution(successful.map((sample) => sample.serverTotalMs).filter(Number.isFinite)),
    dbAcquire: distribution(successful.map((sample) => sample.dbAcquireMs).filter(Number.isFinite)),
    sql: distribution(successful.map((sample) => sample.sqlMs).filter(Number.isFinite)),
    app: distribution(successful.map((sample) => sample.appMs).filter(Number.isFinite)),
  };
}

const settings = readArgs(process.argv);
const key = process.env.NAZRAA_BENCHMARK_KEY;
if (!key) throw new Error('NAZRAA_BENCHMARK_KEY must be set in the local process environment.');

const endpoint = new URL(settings.path, settings.baseUrl).toString();
const results = {};
for (const operation of settings.operations) {
  results[operation] = await runOperation(settings, endpoint, key, operation);
}

console.log(JSON.stringify({
  endpoint: new URL(endpoint).origin + new URL(endpoint).pathname,
  samplesPerOperation: settings.samples,
  concurrency: settings.concurrency,
  generatedAt: new Date().toISOString(),
  results,
}, null, 2));
