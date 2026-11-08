/**
 * Conversation timelines and per-conversation cost (phase 20.6, work order 2 item 4). Data only: the screens come later (the kui track builds the
 * timeline component; the existing pages keep their plain markup and have a place to link here).
 *
 * Two kinds of conversation, two functions:
 *
 *  1. `incidentAiTimeline`: NB's OWN assistant on one incident. Every run of the investigator or a draft becomes a short sequence of steps: the
 *     evidence that was built (counts by kind, sources that were unavailable), the model call (provider, model, tokens, cost), the citation
 *     filter (claims KEPT and claims DROPPED), and the outcome, then thumbs feedback. Tool calls of MCP clients that touched the incident (audit rows
 *     of `audit_log`) are interleaved by time. Cost comes from the usage log `ai` already writes (`ai_usage_logs`): a run is matched to its row by
 *     tenant, provider, model, EXACT token counts and a short time window, so the number is what was billed, not an estimate; a run without a
 *     matching row has `costUsd: null`.
 *
 *  2. `genAiConversation`: a TENANT APP's conversation, the spans of one `gen_ai.conversation.id` ingested through OTLP, ordered by time: model
 *     calls, embeddings, agent invocations, tool executions, retrievals. The convention has no cost attribute and the usage log knows nothing of
 *     tenant applications, so the cost is an ESTIMATE from the same per-model price table `ai` uses for its own log (`costEstimated: true`), and null
 *     for a model without a price. Strings written by the application are cleaned (`hygiene.ts`) before they are returned.
 */
import { freeText } from '../hygiene';
import { getTrace, searchTraces, type QueryDeps } from '../telemetry/telemetry.query.service';
import type { SpanTreeNode } from '../telemetry/telemetry.servicemap';
import { TimeRangeSchema } from '../telemetry/telemetry.types';
import { z } from 'zod';
import { GEN_AI } from './genai.semconv';

export const MAX_CONVERSATION_TRACES = 20;
export const MAX_CONVERSATION_STEPS = 500;
const USAGE_MATCH_BEFORE_MS = 10 * 60_000;
const USAGE_MATCH_AFTER_MS = 60_000;

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

// ── 1. NB's assistant on an incident ──────────────────────────────────────────

export interface RunRow {
  noteId: string; kind: string; status: string; trigger: string; provider?: string | null; model?: string | null; promptVersion?: string | null;
  inputTokens: number; outputTokens: number; result?: Record<string, unknown> | null; evidence?: unknown[] | null; failure?: string | null;
  feedback?: number | null; feedbackAt?: Date | string | null; createdAt: Date | string;
}
export interface UsageLogRow { provider: string; model: string; kind: string; inputTokens: number; outputTokens: number; costUsd?: number | string | null; createdAt: Date | string }
export interface ToolAuditRow { createdAt: Date | string; actorId?: string | null; action: string; metadata?: unknown }

export type TimelineStep =
  | { type: 'evidence'; at: string; count: number; byKind: Record<string, number>; unavailable: string[] }
  | { type: 'model_call'; at: string; provider: string | null; model: string | null; promptVersion: string | null; inputTokens: number; outputTokens: number; costUsd: number | null; costSource: 'usage_log' | 'unmatched' }
  | { type: 'citations'; at: string; kept: { summary: number; hypotheses: number; claims: number }; dropped: { claims: number; hypotheses: number }; insufficient: boolean }
  | { type: 'outcome'; at: string; status: string; failure: string | null }
  | { type: 'feedback'; at: string; value: 1 | -1 }
  | { type: 'tool_call'; at: string; tool: string; kind: string; outcome: string; actorKeyId: string | null };

export interface RunTimeline { noteId: string; kind: string; trigger: string; status: string; at: string; steps: TimelineStep[]; inputTokens: number; outputTokens: number; costUsd: number | null }
export interface IncidentAiTimeline {
  incidentId: string;
  runs: RunTimeline[];
  /** MCP tool calls on this incident, interleaved by time with the runs when read as one list (`events`). */
  tools: Array<Extract<TimelineStep, { type: 'tool_call' }>>;
  events: TimelineStep[];
  totals: { runs: number; modelCalls: number; inputTokens: number; outputTokens: number; costUsd: number | null; claimsKept: number; claimsDropped: number };
}

const iso = (d: Date | string) => new Date(d).toISOString();

/** Pure: the usage-log row that billed this run (exact tokens, same provider and model, written just before the run was stored), or null. */
export function matchUsage(run: Pick<RunRow, 'provider' | 'model' | 'inputTokens' | 'outputTokens' | 'createdAt'>, usage: readonly UsageLogRow[], taken: Set<UsageLogRow> = new Set()): UsageLogRow | null {
  if (!run.provider || !run.model || (run.inputTokens === 0 && run.outputTokens === 0)) return null;
  const at = new Date(run.createdAt).getTime();
  let best: UsageLogRow | null = null;
  for (const u of usage) {
    if (taken.has(u) || u.provider !== run.provider || u.model !== run.model || u.kind !== 'chat') continue;
    if (Number(u.inputTokens) !== run.inputTokens || Number(u.outputTokens) !== run.outputTokens) continue;
    const t = new Date(u.createdAt).getTime();
    if (t < at - USAGE_MATCH_BEFORE_MS || t > at + USAGE_MATCH_AFTER_MS) continue;
    if (!best || Math.abs(t - at) < Math.abs(new Date(best.createdAt).getTime() - at)) best = u;
  }
  if (best) taken.add(best);
  return best;
}

function claimsOf(result: Record<string, unknown> | null | undefined) {
  const summary = Array.isArray(result?.summary) ? (result!.summary as unknown[]).length : 0;
  const hyps = Array.isArray(result?.hypotheses) ? (result!.hypotheses as Array<{ claims?: unknown[] }>) : [];
  const dropped = (result?.dropped ?? {}) as { claims?: number; hypotheses?: number };
  return {
    kept: { summary, hypotheses: hyps.length, claims: summary + hyps.reduce((n, h) => n + (Array.isArray(h.claims) ? h.claims.length : 0), 0) },
    dropped: { claims: Number(dropped.claims) || 0, hypotheses: Number(dropped.hypotheses) || 0 },
  };
}

/** Pure: one run as steps. `usage` is the matched usage-log row, if any. */
export function runSteps(run: RunRow, usage: UsageLogRow | null): TimelineStep[] {
  const at = iso(run.createdAt);
  const steps: TimelineStep[] = [];
  const evidence = Array.isArray(run.evidence) ? (run.evidence as Array<{ kind?: string }>) : [];
  const unavailable = Array.isArray(run.result?.unavailableSources) ? (run.result!.unavailableSources as unknown[]).filter((s): s is string => typeof s === 'string').slice(0, 10) : [];
  if (run.kind === 'INVESTIGATION' || evidence.length) {
    const byKind: Record<string, number> = {};
    for (const e of evidence) byKind[typeof e.kind === 'string' ? e.kind : 'other'] = (byKind[typeof e.kind === 'string' ? e.kind : 'other'] ?? 0) + 1;
    steps.push({ type: 'evidence', at, count: Number(run.result?.evidenceCount) || evidence.length, byKind, unavailable });
  }
  const calledModel = run.status !== 'EMPTY' && (run.provider || run.inputTokens || run.outputTokens);
  if (calledModel) {
    const cost = usage?.costUsd !== null && usage?.costUsd !== undefined && Number.isFinite(Number(usage.costUsd)) ? round6(Number(usage.costUsd)) : null;
    steps.push({ type: 'model_call', at, provider: run.provider ?? null, model: run.model ?? null, promptVersion: run.promptVersion ?? null, inputTokens: run.inputTokens, outputTokens: run.outputTokens, costUsd: cost, costSource: usage ? 'usage_log' : 'unmatched' });
  }
  if (run.status === 'OK' && run.kind === 'INVESTIGATION') {
    const c = claimsOf(run.result);
    steps.push({ type: 'citations', at, kept: c.kept, dropped: c.dropped, insufficient: run.result?.insufficient === true });
  }
  steps.push({ type: 'outcome', at, status: run.status, failure: run.failure ?? null });
  if (run.feedback === 1 || run.feedback === -1) steps.push({ type: 'feedback', at: run.feedbackAt ? iso(run.feedbackAt) : at, value: run.feedback });
  return steps;
}

export function toolCallStep(r: ToolAuditRow): Extract<TimelineStep, { type: 'tool_call' }> {
  const m = (r.metadata && typeof r.metadata === 'object' ? r.metadata : {}) as { tool?: unknown; outcome?: unknown };
  return {
    type: 'tool_call', at: iso(r.createdAt), tool: freeText(m.tool ?? 'unknown', 60), kind: r.action.endsWith('.write') ? 'write' : 'read',
    outcome: freeText(m.outcome ?? 'unknown', 20), actorKeyId: r.actorId ?? null,
  };
}

/** Pure: assemble the timeline of an incident's AI activity. */
export function buildIncidentAiTimeline(incidentId: string, runs: readonly RunRow[], usage: readonly UsageLogRow[], tools: readonly ToolAuditRow[]): IncidentAiTimeline {
  const taken = new Set<UsageLogRow>();
  const ordered = [...runs].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  let anyCost = false;
  const out: RunTimeline[] = ordered.map((r) => {
    const steps = runSteps(r, matchUsage(r, usage, taken));
    const call = steps.find((s): s is Extract<TimelineStep, { type: 'model_call' }> => s.type === 'model_call');
    if (call?.costUsd !== null && call?.costUsd !== undefined) anyCost = true;
    return { noteId: r.noteId, kind: r.kind, trigger: r.trigger, status: r.status, at: iso(r.createdAt), steps, inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: call?.costUsd ?? null };
  });
  const toolSteps = tools.map(toolCallStep).sort((a, b) => a.at.localeCompare(b.at)).slice(0, 200);
  const events = [...out.flatMap((r) => r.steps), ...toolSteps].sort((a, b) => a.at.localeCompare(b.at));
  const citations = out.flatMap((r) => r.steps).filter((s): s is Extract<TimelineStep, { type: 'citations' }> => s.type === 'citations');
  return {
    incidentId, runs: out, tools: toolSteps, events,
    totals: {
      runs: out.length, modelCalls: out.flatMap((r) => r.steps).filter((s) => s.type === 'model_call').length,
      inputTokens: out.reduce((n, r) => n + r.inputTokens, 0), outputTokens: out.reduce((n, r) => n + r.outputTokens, 0),
      costUsd: anyCost ? round6(out.reduce((n, r) => n + (r.costUsd ?? 0), 0)) : null,
      claimsKept: citations.reduce((n, c) => n + c.kept.claims, 0), claimsDropped: citations.reduce((n, c) => n + c.dropped.claims, 0),
    },
  };
}

export interface IncidentTimelineSources {
  runs(tenantId: string, incidentId: string): Promise<RunRow[]>;
  usage(tenantId: string, from: Date, to: Date): Promise<UsageLogRow[]>;
  tools(tenantId: string, incidentId: string): Promise<ToolAuditRow[]>;
}

export async function incidentAiTimeline(src: IncidentTimelineSources, tenantId: string, incidentId: string): Promise<IncidentAiTimeline> {
  const runs = await src.runs(tenantId, incidentId);
  const times = runs.map((r) => new Date(r.createdAt).getTime());
  const usage = times.length ? await src.usage(tenantId, new Date(Math.min(...times) - USAGE_MATCH_BEFORE_MS), new Date(Math.max(...times) + USAGE_MATCH_AFTER_MS)).catch(() => []) : [];
  const tools = await src.tools(tenantId, incidentId).catch(() => []);
  return buildIncidentAiTimeline(incidentId, runs, usage, tools);
}

// ── 2. a tenant application's conversation ────────────────────────────────────

export const ConversationInputSchema = z.object({ range: TimeRangeSchema, limit: z.number().int().min(1).max(MAX_CONVERSATION_TRACES).default(MAX_CONVERSATION_TRACES) }).strict();

export type ConversationStepType = 'model_call' | 'embedding' | 'agent' | 'tool_call' | 'retrieval';
export interface ConversationStep {
  type: ConversationStepType; at: string; offsetMs: number; durationMs: number; name: string; model: string | null; provider: string | null;
  tool: string | null; agent: string | null; inputTokens: number; outputTokens: number; error: boolean; traceId: string; spanId: string; costUsd: number | null;
}
export interface GenAiConversationTimeline {
  conversationId: string;
  found: boolean;
  steps: ConversationStep[];
  truncated: boolean;
  totals: { steps: number; modelCalls: number; toolCalls: number; errors: number; inputTokens: number; outputTokens: number; durationMs: number; costUsd: number | null; costEstimated: true };
}

export type PriceFn = (model: string, inputTokens: number, outputTokens: number) => number | undefined;

const TYPE_OF: Record<string, ConversationStepType> = {
  chat: 'model_call', text_completion: 'model_call', generate_content: 'model_call', embeddings: 'embedding', invoke_agent: 'agent', execute_tool: 'tool_call', retrieval: 'retrieval',
};
const str = (v: unknown, max = 120): string | null => (typeof v === 'string' && v ? freeText(v, max) : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

/** Pure: the steps of one conversation found in a trace's span tree. */
export function conversationSteps(conversationId: string, traceId: string, roots: SpanTreeNode[], price: PriceFn): Array<ConversationStep & { startMs: number }> {
  const out: Array<ConversationStep & { startMs: number }> = [];
  const walk = (n: SpanTreeNode) => {
    const op = n.attributes[GEN_AI.operationName];
    const cid = n.attributes[GEN_AI.conversationId];
    if (typeof op === 'string' && TYPE_OF[op] && cid === conversationId) {
      const model = str(n.attributes[GEN_AI.responseModel] ?? n.attributes[GEN_AI.requestModel]);
      const inT = num(n.attributes[GEN_AI.usageInputTokens]); const outT = num(n.attributes[GEN_AI.usageOutputTokens]);
      const cost = model && (inT || outT) ? price(model, inT, outT) : undefined;
      out.push({
        type: TYPE_OF[op]!, at: new Date(n.startMs).toISOString(), startMs: n.startMs, offsetMs: 0, durationMs: Math.round(n.durationMs), name: freeText(n.name, 120), model, provider: str(n.attributes[GEN_AI.providerName], 60),
        tool: str(n.attributes['gen_ai.tool.name'], 80), agent: str(n.attributes[GEN_AI.agentName], 80), inputTokens: inT, outputTokens: outT,
        error: n.status === 'ERROR' || n.attributes[GEN_AI.errorType] !== undefined, traceId, spanId: n.spanId, costUsd: cost === undefined ? null : round6(cost),
      });
    }
    n.children.forEach(walk);
  };
  roots.forEach(walk);
  return out;
}

/** Pure: order the steps and total them. */
export function summariseConversation(conversationId: string, steps: Array<ConversationStep & { startMs: number }>, truncated: boolean): GenAiConversationTimeline {
  const ordered = [...steps].sort((a, b) => a.startMs - b.startMs || a.spanId.localeCompare(b.spanId)).slice(0, MAX_CONVERSATION_STEPS);
  const t0 = ordered[0]?.startMs ?? 0;
  const view: ConversationStep[] = ordered.map(({ startMs, ...s }) => ({ ...s, offsetMs: Math.round(startMs - t0) }));
  const priced = view.filter((s) => s.costUsd !== null);
  const end = ordered.reduce((m, s) => Math.max(m, s.startMs + s.durationMs), t0);
  return {
    conversationId, found: view.length > 0, steps: view, truncated: truncated || steps.length > MAX_CONVERSATION_STEPS,
    totals: {
      steps: view.length, modelCalls: view.filter((s) => s.type === 'model_call').length, toolCalls: view.filter((s) => s.type === 'tool_call').length, errors: view.filter((s) => s.error).length,
      inputTokens: view.reduce((n, s) => n + s.inputTokens, 0), outputTokens: view.reduce((n, s) => n + s.outputTokens, 0), durationMs: Math.round(end - t0),
      costUsd: priced.length ? round6(priced.reduce((n, s) => n + (s.costUsd ?? 0), 0)) : null, costEstimated: true,
    },
  };
}

/** Read the conversation through the structured trace API (tenant filter, caps and limits of phase 18 apply). A sample of the most recent matching traces. */
export async function genAiConversation(deps: QueryDeps, tenantId: string, conversationId: string, input: unknown, price: PriceFn): Promise<GenAiConversationTimeline> {
  const { range, limit } = ConversationInputSchema.parse(input);
  const found = await searchTraces(deps, tenantId, { range, limit, attributes: [{ key: GEN_AI.conversationId, value: conversationId }] });
  const ids = found.traces.map((t) => t.traceId).slice(0, limit);
  const steps: Array<ConversationStep & { startMs: number }> = [];
  for (const id of ids) {
    try { steps.push(...conversationSteps(conversationId, id, (await getTrace(deps, tenantId, id)).tree, price)); } catch { /* a trace that expired between search and read is skipped */ }
  }
  return summariseConversation(conversationId, steps, ids.length >= limit);
}

export const CONVERSATION_ID = /^[A-Za-z0-9][A-Za-z0-9_.:\-/]{0,99}$/;
