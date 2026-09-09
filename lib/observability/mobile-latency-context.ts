import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import type { PoolConnection } from "mysql2/promise";

export type MobileLatencyTrace = {
  operation: string;
  startedAt: number;
  dbAcquireMs: number;
  dbTransactionMs: number;
  dbQueryMs: number;
};

const storage = new AsyncLocalStorage<MobileLatencyTrace>();

export async function traceMobileRequest<T extends Response>(
  operation: string,
  handler: () => Promise<T>,
): Promise<{ response: T; trace: MobileLatencyTrace }> {
  const trace: MobileLatencyTrace = {
    operation: operation.slice(0, 96),
    startedAt: performance.now(),
    dbAcquireMs: 0,
    dbTransactionMs: 0,
    dbQueryMs: 0,
  };
  return storage.run(trace, async () => {
    const response = await handler();
    const total = Math.max(0, performance.now() - trace.startedAt);
    // Browser/mobile tooling can read this without exposing SQL, host names,
    // user content, credentials, or a raw internal error.
    response.headers.set(
      "Server-Timing",
      [
        `app;dur=${total.toFixed(1)}`,
        `db-acquire;dur=${trace.dbAcquireMs.toFixed(1)}`,
        `db-tx;dur=${trace.dbTransactionMs.toFixed(1)}`,
        `db-query;dur=${trace.dbQueryMs.toFixed(1)}`,
      ].join(", "),
    );
    return { response, trace };
  });
}

export function recordDatabaseAcquire(milliseconds: number) {
  const trace = storage.getStore();
  if (trace) trace.dbAcquireMs += Math.max(0, milliseconds);
}

export function recordDatabaseTransaction(milliseconds: number) {
  const trace = storage.getStore();
  if (trace) trace.dbTransactionMs += Math.max(0, milliseconds);
}

export function recordDatabaseQuery(milliseconds: number) {
  const trace = storage.getStore();
  if (trace) trace.dbQueryMs += Math.max(0, milliseconds);
}

export function mobileLatencySnapshot(trace: MobileLatencyTrace) {
  const totalMs = Math.max(0, performance.now() - trace.startedAt);
  return {
    operation: trace.operation,
    totalMs: Math.round(totalMs),
    dbAcquireMs: Math.round(trace.dbAcquireMs),
    dbTransactionMs: Math.round(trace.dbTransactionMs),
    dbQueryMs: Math.round(trace.dbQueryMs),
    backendMs: Math.max(0, Math.round(totalMs - trace.dbAcquireMs - trace.dbTransactionMs)),
  };
}

// Keep this type import used by transaction instrumentation callers without
// coupling this context to the database pool implementation.
export type TimedPoolConnection = PoolConnection;
