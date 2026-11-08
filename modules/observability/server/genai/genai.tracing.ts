/**
 * Opt-in GenAI tracing for NB's own `ai`, `ai_agent` and `ai_chat` calls (phase 20.6). They all reach a provider through `AIService`, and
 * `AIService` runs every provider call through the `ai.hooks` seam; this installs ONE wrapper there that opens a span per call through the
 * existing tracing facade (`withSpan`), named and attributed after the pinned convention (`genai.semconv.ts`).
 *
 * Two switches, both required: the deployment flag `GENAI_TRACING=true` (nothing is installed without it) and the tenant's own
 * `genAiTracing` setting (read through a short cache, so a model call does not cost a settings read each time). Without either, a call is
 * not traced and nothing here runs for it. Tracing never changes a call: the wrapper's result and errors are the call's.
 */
import Logger from '@kuraykaraaslan-labs/logger';
import { withSpan, type SpanHandle } from '../tracing';
import { errorTypeOf, GEN_AI, spanEndFor, spanStartFor } from './genai.semconv';
import { loadAiPeer } from '../peers/peers';
import type { AiCallMeta, AiCallResult, AiCallWrapper } from '../peers/peers.types';

export interface GenAiTracingDeps {
  /** Has this tenant opted in? Called once per traced call. */
  tenantEnabled(tenantId: string): Promise<boolean>;
  spanRunner?: <T>(name: string, fn: (span: SpanHandle) => T, opts: { op: string; attributes: Record<string, string | number | boolean> }) => T;
}

export function makeGenAiWrapper(deps: GenAiTracingDeps): AiCallWrapper {
  const run = deps.spanRunner ?? withSpan;
  return async (meta: AiCallMeta, call: () => Promise<AiCallResult>) => {
    let on = false;
    try { on = await deps.tenantEnabled(meta.tenantId); } catch { on = false; }
    if (!on) return call();
    const start = spanStartFor(meta);
    return run(start.name, async (span) => {
      try {
        const result = await call();
        for (const [k, v] of Object.entries(spanEndFor(meta, result))) span.setAttribute(k, v);
        return result;
      } catch (e) {
        span.setAttribute(GEN_AI.errorType, errorTypeOf(e));
        throw e;
      }
    }, { op: 'gen_ai', attributes: start.attributes });
  };
}

const TTL_MS = 60_000;

/** Tenant opt-in through the tenant's settings, cached per tenant for a minute. */
export function cachedTenantGate(read: (tenantId: string) => Promise<boolean>, now: () => number = Date.now): (tenantId: string) => Promise<boolean> {
  const cache = new Map<string, { at: number; value: boolean }>();
  return async (tenantId) => {
    const hit = cache.get(tenantId);
    if (hit && now() - hit.at < TTL_MS) return hit.value;
    const value = await read(tenantId);
    if (cache.size > 5000) cache.clear();
    cache.set(tenantId, { at: now(), value });
    return value;
  };
}

let installed = false;

/** Install the wrapper when the deployment flag (env GENAI_TRACING) is on and the `ai` module is present (through the `observability:ai-peer` point). Idempotent; never throws. */
export async function installGenAiTracing(flag?: boolean): Promise<boolean> {
  const on = flag ?? (await import('@kuraykaraaslan-labs/env')).env.GENAI_TRACING;
  if (installed || !on) return installed;
  try {
    const ai = await loadAiPeer(null, 'observability: GenAI tracing installs one wrapper for the whole platform');
    if (!ai) return installed;
    const { getAiSettings } = await import('../ai/ai.settings');
    ai.setCallWrapper(makeGenAiWrapper({ tenantEnabled: cachedTenantGate(async (t) => (await getAiSettings(t)).genAiTracing) }));
    installed = true;
  } catch (e) {
    Logger.warn(`[observability] GenAI tracing not installed: ${e instanceof Error ? e.message : String(e)}`);
  }
  return installed;
}

/** Test seam. */
export function resetGenAiTracingForTests(): void { installed = false; }
