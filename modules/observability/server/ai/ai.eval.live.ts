/**
 * The REAL-MODEL evaluation of the investigator (phase 20.7, work order 2 item 5): the golden incidents run through the production code path
 * (`investigate`: gate-free here, evidence bundle, prompt, `ModelPort`, strict parse, citation filter) against a real provider reached through the
 * `ai` module with the tenant's own key, and scored on what the fake-model set cannot tell:
 *
 *   citation validity   share of the model's RAW claims that cite at least one evidence id and only ids that exist (before the filter)
 *   drop rate           share of raw claims the renderer had to drop (uncited, unknown id; or inside a dropped hypothesis)
 *   groundedness        share of the salient tokens of every KEPT claim (numbers, versions, identifiers, proper names) that appear in the evidence
 *                       the claim cites. A lexical heuristic: it catches an invented number or service name, not a wrong inference.
 *   cost                tokens from the reply, dollars from the price table `ai` prices its own usage log with (null for an unpriced model)
 *   coverage            for each expected finding of the fixture, whether a kept claim cites evidence of the kind it should (title wording is the
 *                       model's, so only the cited KINDS are compared)
 *
 * The scoring and the runner are pure over a `ModelPort`, so they are tested with a scripted model. Whether a real provider meets the thresholds is
 * only known when `npm run eval:investigator -- --live` runs with a key; nothing here fakes that.
 */
import { evidenceFromPrompt } from './ai.fake-model';
import type { EvidenceItem } from './ai.evidence';
import { INVESTIGATOR_PROMPT_VERSION } from './ai.prompt';
import { InvestigationOutputSchema, extractJson, type CitedResult } from './ai.schema';
import { investigate } from './ai.investigator';
import { AI_SETTINGS_DEFAULT } from './ai.settings.schema';
import type { ModelPort, ModelReply, ModelRequest } from './ai.model';
import type { NewRun } from './ai.store';
import { sourcesFor, type GoldenFixture } from './ai.eval';

export interface LiveThresholds { minValidity: number; maxDropRate: number; minGroundedness: number }
export const DEFAULT_THRESHOLDS: LiveThresholds = { minValidity: 0.9, maxDropRate: 0.2, minGroundedness: 0.7 };

export interface LiveFixtureScore {
  fixture: string;
  status: 'OK' | 'EMPTY' | 'FAILED';
  modelCalls: number;
  rawClaims: number;
  keptClaims: number;
  validClaims: number;
  citationValidity: number | null;
  dropRate: number | null;
  groundedness: number | null;
  ungroundedClaims: string[];
  coverage: { expected: number; met: number } | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  latencyMs: number;
  provider: string | null;
  model: string | null;
  promptVersion: string;
  failure: string | null;
}

export interface LiveReport {
  mode: 'live';
  startedAt: string;
  provider: string;
  model: string | null;
  promptVersion: string;
  fixtures: LiveFixtureScore[];
  aggregate: { fixtures: number; modelCalls: number; rawClaims: number; citationValidity: number | null; dropRate: number | null; groundedness: number | null; inputTokens: number; outputTokens: number; costUsd: number | null; failedRuns: number };
  thresholds: LiveThresholds;
  failures: string[];
}

// ── groundedness ──────────────────────────────────────────────────────────────

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'was', 'were', 'has', 'have', 'had', 'not', 'but', 'its', 'into', 'than', 'then', 'out', 'all', 'any', 'can', 'will', 'incident', 'alert', 'severity', 'major', 'minor', 'critical', 'status', 'open', 'resolved', 'started', 'evidence']);

/** The checkable tokens of a claim: numbers, versions, identifiers (digits, `_`, `-`, `.`, `:`, `/`, camelCase) and capitalised names not at the start of a sentence. Lower-cased, unique. */
export function salientTokens(text: string): string[] {
  const out = new Set<string>();
  const clean = text.replace(/[`"'()[\]{}<>]/g, ' ');
  const words = clean.split(/\s+/).map((w) => w.replace(/^[,;:!?]+|[,;:!?]+$/g, '').replace(/\.+$/, '')).filter(Boolean);
  words.forEach((w, i) => {
    const lw = w.toLowerCase();
    if (STOP.has(lw)) return;
    const sentenceStart = i === 0 || /[.!?]$/.test(words[i - 1] ?? '');
    const hasDigit = /\d/.test(w);
    const identifier = /[_/:]/.test(w) || /[a-z][A-Z]/.test(w) || (/-/.test(w) && hasDigit) || /\w\.\w/.test(w);
    const proper = !sentenceStart && /^[A-Z][A-Za-z0-9]{2,}$/.test(w);
    if (hasDigit || identifier || proper) out.add(lw.replace(/^[^\w]+|[^\w%]+$/g, ''));
  });
  out.delete('');
  return [...out];
}

/** The share of a claim's salient tokens found in the text of the evidence it cites; null when it has nothing checkable. */
export function claimGroundedness(claimText: string, cited: readonly EvidenceItem[]): number | null {
  const tokens = salientTokens(claimText);
  if (tokens.length === 0) return null;
  const haystack = cited.map((e) => `${e.title} ${e.detail}`).join(' ').toLowerCase();
  const found = tokens.filter((t) => haystack.includes(t)).length;
  return found / tokens.length;
}

// ── scoring one run ───────────────────────────────────────────────────────────

export interface RawCounts { claims: number; valid: number }

/** Raw claim counts of the model's reply before the citation filter; `null` when the reply is not the required shape. */
export function rawClaimCounts(replyText: string, knownIds: ReadonlySet<string>): RawCounts | null {
  let json: unknown;
  try { json = extractJson(replyText); } catch { return null; }
  const parsed = InvestigationOutputSchema.safeParse(json);
  if (!parsed.success) return null;
  const claims = [...parsed.data.summary, ...parsed.data.hypotheses.flatMap((h) => h.claims)];
  return { claims: claims.length, valid: claims.filter((c) => c.evidence.length > 0 && c.evidence.every((id) => knownIds.has(id))).length };
}

const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);
const round = (n: number | null, d = 4) => (n === null ? null : Math.round(n * 10 ** d) / 10 ** d);

export type PriceFn = (model: string, inputTokens: number, outputTokens: number) => number | undefined;

export function scoreRun(input: {
  fixture: GoldenFixture; status: 'OK' | 'EMPTY' | 'FAILED'; replyText: string | null; evidence: readonly EvidenceItem[]; result: (CitedResult & { insufficient?: boolean }) | null;
  inputTokens: number; outputTokens: number; provider: string | null; model: string | null; latencyMs: number; modelCalls: number; failure: string | null; price?: PriceFn;
}): LiveFixtureScore {
  const known = new Set(input.evidence.map((e) => e.id));
  const raw = input.replyText ? rawClaimCounts(input.replyText, known) : null;
  const kept = input.result && Array.isArray(input.result.summary) ? [...input.result.summary, ...input.result.hypotheses.flatMap((h) => h.claims)] : [];
  const byId = new Map(input.evidence.map((e) => [e.id, e]));
  const grounded: number[] = [];
  const ungrounded: string[] = [];
  for (const c of kept) {
    const g = claimGroundedness(c.text, c.evidence.map((id) => byId.get(id)).filter((e): e is EvidenceItem => !!e));
    if (g === null) continue;
    grounded.push(g);
    if (g < 0.5) ungrounded.push(c.text.slice(0, 160));
  }
  const expected = input.fixture.expect.findings ?? [];
  const kindOf = (id: string) => byId.get(id)?.kind;
  const met = expected.filter((f) => f.citesKinds.every((k) => kept.some((c) => c.evidence.some((id) => kindOf(id) === k)))).length;
  const cost = input.model && input.price ? input.price(input.model, input.inputTokens, input.outputTokens) : undefined;
  const rawClaims = raw?.claims ?? 0;
  return {
    fixture: input.fixture.name, status: input.status, modelCalls: input.modelCalls, rawClaims, keptClaims: kept.length, validClaims: raw?.valid ?? 0,
    citationValidity: round(raw ? ratio(raw.valid, raw.claims) : null),
    dropRate: round(raw ? ratio(Math.max(0, raw.claims - kept.length), raw.claims) : null),
    groundedness: round(grounded.length ? grounded.reduce((a, b) => a + b, 0) / grounded.length : null),
    ungroundedClaims: ungrounded.slice(0, 5),
    coverage: input.status === 'OK' && expected.length ? { expected: expected.length, met } : null,
    inputTokens: input.inputTokens, outputTokens: input.outputTokens, costUsd: cost === undefined ? null : round(cost, 6),
    latencyMs: Math.round(input.latencyMs), provider: input.provider, model: input.model, promptVersion: INVESTIGATOR_PROMPT_VERSION, failure: input.failure,
  };
}

// ── the runner ────────────────────────────────────────────────────────────────

/** Wraps a port, keeping the raw reply text and the call count of the last run. */
export class RecordingModel implements ModelPort {
  last: { text: string; reply: ModelReply; request: ModelRequest; ms: number } | null = null;
  calls = 0;
  constructor(private readonly inner: ModelPort) {}
  available(tenantId: string) { return this.inner.available(tenantId); }
  async complete(tenantId: string, req: ModelRequest): Promise<ModelReply> {
    const t0 = Date.now();
    this.calls += 1;
    const reply = await this.inner.complete(tenantId, req);
    this.last = { text: reply.text, reply, request: req, ms: Date.now() - t0 };
    return reply;
  }
}

export interface LiveOptions {
  model: ModelPort;
  tenantId: string;
  provider: string;
  modelName?: string;
  price?: PriceFn;
  thresholds?: Partial<LiveThresholds>;
  /** Stop after this many model calls (the budget guard). */
  maxCalls?: number;
  now?: () => Date;
}

export class LiveEvalUnavailable extends Error {
  constructor(message: string) { super(message); this.name = 'LiveEvalUnavailable'; }
}

export async function runLiveEval(fixtures: readonly GoldenFixture[], o: LiveOptions): Promise<LiveReport> {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...o.thresholds };
  if (!(await o.model.available(o.tenantId))) {
    throw new LiveEvalUnavailable('The AI provider is not available for this workspace (module not installed, no provider configured, or the plan or token quota refuses it). Nothing was run.');
  }
  const startedAt = (o.now ?? (() => new Date()))().toISOString();
  const scores: LiveFixtureScore[] = [];
  let calls = 0;
  for (const fx of fixtures) {
    if (calls >= (o.maxCalls ?? 20)) break;
    const rec = new RecordingModel(o.model);
    const saved: NewRun[] = [];
    let status: LiveFixtureScore['status'] = 'FAILED';
    let failure: string | null = null;
    let result: (CitedResult & { insufficient?: boolean }) | null = null;
    let evidence: EvidenceItem[] = [];
    const t0 = Date.now();
    try {
      const view = await investigate({
        sources: sourcesFor(fx), model: rec,
        settings: async () => ({ ...AI_SETTINGS_DEFAULT, enabled: true, providers: [o.provider], ...(o.modelName ? { model: o.modelName } : {}), dailyCap: 1000 }), countToday: async () => 0,
        save: (async (tenantId: string, run: NewRun) => { saved.push(run); return { noteId: `live-${saved.length}`, tenantId, createdAt: new Date(fx.now), inputTokens: run.inputTokens ?? 0, outputTokens: run.outputTokens ?? 0, ...run }; }) as never,
        timeline: (async () => undefined) as never, now: () => new Date(fx.now),
      }, o.tenantId, fx.sources.incident.incidentId, { trigger: 'MANUAL' });
      status = view.status as LiveFixtureScore['status'];
      failure = view.failure;
      result = (view.result as unknown as (CitedResult & { insufficient?: boolean }) | null);
      // The evidence the model saw, with every id, is what the bundle held: the run stores only the cited part, so rebuild it from the prompt.
      evidence = rec.last ? (evidenceFromPrompt(rec.last.request.prompt) as unknown as EvidenceItem[]) : (view.evidence as EvidenceItem[]);
    } catch (e) {
      failure = e instanceof Error ? e.name : 'error';
    }
    calls += rec.calls;
    scores.push(scoreRun({
      fixture: fx, status, replyText: rec.last?.text ?? null, evidence, result, inputTokens: rec.last?.reply.inputTokens ?? 0, outputTokens: rec.last?.reply.outputTokens ?? 0,
      provider: rec.last?.reply.provider ?? o.provider, model: rec.last?.reply.model ?? o.modelName ?? null, latencyMs: rec.last?.ms ?? Date.now() - t0, modelCalls: rec.calls, failure, price: o.price,
    }));
  }
  return report(scores, o, startedAt, thresholds);
}

function report(scores: LiveFixtureScore[], o: LiveOptions, startedAt: string, thresholds: LiveThresholds): LiveReport {
  const called = scores.filter((s) => s.modelCalls > 0);
  const rawClaims = called.reduce((n, s) => n + s.rawClaims, 0);
  const validClaims = called.reduce((n, s) => n + s.validClaims, 0);
  const keptClaims = called.filter((s) => s.dropRate !== null).reduce((n, s) => n + Math.min(s.keptClaims, s.rawClaims), 0);
  const rawForDrop = called.filter((s) => s.dropRate !== null).reduce((n, s) => n + s.rawClaims, 0);
  const grounded = called.filter((s) => s.groundedness !== null);
  const priced = called.filter((s) => s.costUsd !== null);
  const aggregate = {
    fixtures: scores.length, modelCalls: called.reduce((n, s) => n + s.modelCalls, 0), rawClaims,
    citationValidity: round(ratio(validClaims, rawClaims)), dropRate: round(ratio(rawForDrop - keptClaims, rawForDrop)),
    groundedness: round(grounded.length ? grounded.reduce((a, s) => a + (s.groundedness ?? 0), 0) / grounded.length : null),
    inputTokens: called.reduce((n, s) => n + s.inputTokens, 0), outputTokens: called.reduce((n, s) => n + s.outputTokens, 0),
    costUsd: priced.length ? round(priced.reduce((n, s) => n + (s.costUsd ?? 0), 0), 6) : null, failedRuns: called.filter((s) => s.status === 'FAILED').length,
  };
  const failures: string[] = [];
  if (called.length === 0) failures.push('no model call was made');
  if (aggregate.citationValidity !== null && aggregate.citationValidity < thresholds.minValidity) failures.push(`citation validity ${aggregate.citationValidity} is below ${thresholds.minValidity}`);
  if (aggregate.dropRate !== null && aggregate.dropRate > thresholds.maxDropRate) failures.push(`drop rate ${aggregate.dropRate} is above ${thresholds.maxDropRate}`);
  if (aggregate.groundedness !== null && aggregate.groundedness < thresholds.minGroundedness) failures.push(`groundedness ${aggregate.groundedness} is below ${thresholds.minGroundedness}`);
  if (aggregate.failedRuns > 0) failures.push(`${aggregate.failedRuns} run(s) failed (unusable reply or provider error)`);
  for (const s of scores) if (s.status === 'EMPTY' && s.modelCalls > 0) failures.push(`${s.fixture}: an EMPTY run made a model call`);
  return { mode: 'live', startedAt, provider: o.provider, model: o.modelName ?? null, promptVersion: INVESTIGATOR_PROMPT_VERSION, fixtures: scores, aggregate, thresholds, failures };
}
