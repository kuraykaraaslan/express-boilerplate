/**
 * Trace context across BullMQ (phase 17.3): a job learns which request enqueued it.
 *
 * The producer side and the worker side are the shared `createQueue` / `createWorker` of the redis module (the one place every queue passes);
 * they call the propagator registered here. So no producer is edited one by one: a queue made by the factory carries the context, a queue made
 * with a bare `new Queue` does not (it keeps working, it just starts a new trace on the worker side).
 *
 *   enqueue:   the payload gets `__trace` = { traceparent, requestId } from the ACTIVE span (OpenTelemetry, else Sentry) and the request id of the
 *              log context (`injectTrace`); with neither there is nothing to carry and the payload is stored unchanged
 *   process:   the carrier is removed from `job.data` before the handler sees it, the OpenTelemetry context continues the producer's span
 *              (`runInTrace`), and the log context takes the producer's request id, so every log line the job writes has the request id of the request
 *              that enqueued it, and (request id and trace id being the same 128 bits for NB-minted ids) the same trace id.
 *
 * `x-request-id` is attacker-writable (a client sends one); the carrier only ever holds an id that matches the request-id shape, and a handler
 * that needs a tenant still takes it from its own payload: the carrier decides nothing but the trace and the log correlation.
 */
import { getJobPropagator, setJobPropagator, type JobPropagator } from '@kuraykaraaslan-labs/redis/server/redis.bullmq';
import Logger from '@kuraykaraaslan-labs/logger';
import { runWithJobContext } from '@kuraykaraaslan-labs/logger/server/logger.request-context';
import { extractTrace, injectTrace, runInTrace } from './telemetry.propagation';

export const traceJobPropagator: JobPropagator = {
  inject<T>(data: T): T {
    // Only a plain object payload can carry the key; anything else (a string, an array) is stored as it was given.
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return data;
    const requestId = Logger.getContext?.().requestId;
    return injectTrace(data as object, typeof requestId === 'string' ? { requestId } : {}) as T;
  },
  run<R>(job: { name: string; data: unknown }, fn: () => R): R {
    const { payload, trace, requestId } = extractTrace(job.data);
    job.data = payload;
    const inTrace = () => runInTrace(trace, fn);
    return requestId ? Logger.runWithContext({ requestId }, inTrace) : runWithJobContext(job.name, inTrace);
  },
};

/** `common:boot_task` entry (phase `consumer`: every process that produces or consumes jobs, web tier and workers alike). Idempotent. */
export async function startJobTracePropagation(): Promise<void> {
  if (getJobPropagator() !== traceJobPropagator) setJobPropagator(traceJobPropagator);
}

export function stopJobTracePropagation(): void {
  if (getJobPropagator() === traceJobPropagator) setJobPropagator(null);
}
