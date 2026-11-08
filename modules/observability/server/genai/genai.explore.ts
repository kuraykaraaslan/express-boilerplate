/**
 * What a tenant's own LLM applications sent through OTLP (phase 17) as `gen_ai.*` spans, summarised for the explorer (phase 20.6): per model
 * calls, tokens, errors and latency, and conversations (spans sharing `gen_ai.conversation.id`). Read through the structured trace query
 * API only, so the tenant filter, the caps and the rate limit of phase 18 apply unchanged.
 *
 * It is a SAMPLE, not a census: the most recent traces that carry a GenAI operation, at most `MAX_TRACES` of them. Cost is not in the
 * convention, so none is shown here; the cost of NB's OWN calls comes from the usage log (`genai.usage.ts`).
 * Span attribute values are written by the tenant's application: strings are cleaned before they are returned.
 */
import { freeText } from '../hygiene';
import { getTrace, searchTraces, type QueryDeps } from '../telemetry/telemetry.query.service';
import type { SpanTreeNode } from '../telemetry/telemetry.servicemap';
import { TimeRangeSchema } from '../telemetry/telemetry.types';
import { z } from 'zod';
import { GEN_AI, GEN_AI_OPERATIONS } from './genai.semconv';

export const MAX_TRACES = 30;
const SEARCH_OPERATIONS = ['chat', 'embeddings', 'invoke_agent'] as const;

export const GenAiOverviewInputSchema = z.object({ range: TimeRangeSchema }).strict();

export interface GenAiSpanView { traceId: string; spanId: string; operation: string; model: string | null; provider: string | null; conversationId: string | null; inputTokens: number; outputTokens: number; error: boolean; startMs: number; durationMs: number; name: string }

export interface GenAiModelLine { model: string; provider: string | null; calls: number; errors: number; inputTokens: number; outputTokens: number; avgDurationMs: number }
export interface GenAiConversation { id: string; spans: number; inputTokens: number; outputTokens: number; errors: number; startedMs: number; durationMs: number; models: string[]; traceIds: string[] }
export interface GenAiOverview { sample: { traces: number; spans: number }; byModel: GenAiModelLine[]; conversations: GenAiConversation[] }

const str = (v: unknown, max = 120): string | null => (typeof v === 'string' && v ? freeText(v, max) : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

export function genAiSpans(traceId: string, roots: SpanTreeNode[]): GenAiSpanView[] {
  const out: GenAiSpanView[] = [];
  const walk = (n: SpanTreeNode) => {
    const op = n.attributes[GEN_AI.operationName];
    if (typeof op === 'string' && (GEN_AI_OPERATIONS as readonly string[]).includes(op)) {
      out.push({
        traceId, spanId: n.spanId, operation: op, model: str(n.attributes[GEN_AI.responseModel] ?? n.attributes[GEN_AI.requestModel]), provider: str(n.attributes[GEN_AI.providerName], 60),
        conversationId: str(n.attributes[GEN_AI.conversationId], 100), inputTokens: num(n.attributes[GEN_AI.usageInputTokens]), outputTokens: num(n.attributes[GEN_AI.usageOutputTokens]),
        error: n.status === 'ERROR' || n.attributes[GEN_AI.errorType] !== undefined, startMs: n.startMs, durationMs: n.durationMs, name: freeText(n.name, 120),
      });
    }
    n.children.forEach(walk);
  };
  roots.forEach(walk);
  return out;
}

/** Pure: the summary of a set of GenAI spans. */
export function summariseGenAi(spans: readonly GenAiSpanView[], traces: number): GenAiOverview {
  const models = new Map<string, GenAiModelLine & { total: number }>();
  const convs = new Map<string, GenAiConversation & { end: number }>();
  for (const s of spans) {
    if (s.operation === 'chat' || s.operation === 'text_completion' || s.operation === 'embeddings' || s.operation === 'generate_content') {
      const key = `${s.provider ?? ''}\u0000${s.model ?? 'unknown'}`;
      const m = models.get(key) ?? { model: s.model ?? 'unknown', provider: s.provider, calls: 0, errors: 0, inputTokens: 0, outputTokens: 0, avgDurationMs: 0, total: 0 };
      m.calls += 1; m.errors += s.error ? 1 : 0; m.inputTokens += s.inputTokens; m.outputTokens += s.outputTokens; m.total += s.durationMs;
      models.set(key, m);
    }
    if (s.conversationId) {
      const c = convs.get(s.conversationId) ?? { id: s.conversationId, spans: 0, inputTokens: 0, outputTokens: 0, errors: 0, startedMs: s.startMs, durationMs: 0, models: [], traceIds: [], end: s.startMs + s.durationMs };
      c.spans += 1; c.inputTokens += s.inputTokens; c.outputTokens += s.outputTokens; c.errors += s.error ? 1 : 0;
      c.startedMs = Math.min(c.startedMs, s.startMs); c.end = Math.max(c.end, s.startMs + s.durationMs);
      if (s.model && !c.models.includes(s.model)) c.models.push(s.model);
      if (!c.traceIds.includes(s.traceId)) c.traceIds.push(s.traceId);
      convs.set(s.conversationId, c);
    }
  }
  return {
    sample: { traces, spans: spans.length },
    byModel: [...models.values()].map(({ total, ...m }) => ({ ...m, avgDurationMs: m.calls ? Math.round((total / m.calls) * 10) / 10 : 0 })).sort((a, b) => b.calls - a.calls).slice(0, 50),
    conversations: [...convs.values()].map(({ end, ...c }) => ({ ...c, durationMs: Math.round(end - c.startedMs), models: c.models.slice(0, 5), traceIds: c.traceIds.slice(0, 10) })).sort((a, b) => b.startedMs - a.startedMs).slice(0, 50),
  };
}

export async function genAiOverview(deps: QueryDeps, tenantId: string, input: unknown): Promise<GenAiOverview> {
  const { range } = GenAiOverviewInputSchema.parse(input);
  const ids = new Set<string>();
  for (const op of SEARCH_OPERATIONS) {
    const r = await searchTraces(deps, tenantId, { range, limit: 20, attributes: [{ key: GEN_AI.operationName, value: op }] });
    for (const t of r.traces) ids.add(t.traceId);
    if (ids.size >= MAX_TRACES) break;
  }
  const picked = [...ids].slice(0, MAX_TRACES);
  const spans: GenAiSpanView[] = [];
  let next = 0;
  const worker = async () => {
    while (next < picked.length) {
      const id = picked[next++]!;
      try { spans.push(...genAiSpans(id, (await getTrace(deps, tenantId, id)).tree)); } catch { /* a trace that expired between search and read is skipped */ }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return summariseGenAi(spans, picked.length);
}
