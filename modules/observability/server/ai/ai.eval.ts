/**
 * The evaluation of the investigator (phase 20.7): a golden set of past incidents (`eval/golden/*.json`) with the evidence each must produce and
 * the findings a faithful model is expected to cite, run end to end against a FAKE model, so it is deterministic and costs nothing. It is the
 * gate before a change to the prompt, the schema or the citation filter ships: `npm run eval:investigator` exits non-zero on any failure.
 *
 * What it proves, per fixture:
 *   - the bundle holds the evidence kinds the incident should have produced, and names what was unavailable
 *   - a faithful model's answer survives with the expected findings, each citing evidence of the expected kind
 *   - EVERY surviving claim resolves to a stored evidence row (the citation rule)
 *   - attacks on the renderer fail closed: a hallucinating model (uncited claims, ids that do not exist), garbage and wrong-shaped replies,
 *     and a model that obeys an instruction planted in the evidence
 *   - secrets in the evidence never reach the prompt
 *
 * What it does NOT prove: that a real model answers well. Quality against a real provider is measured by a person reading real runs (the thumbs
 * feedback), not by this set.
 */
import type { AlertFacts, EvidenceSources, IncidentFacts, SimilarFacts, SloFacts, TelemetryFacts } from './ai.evidence';
import { buildEvidenceBundle } from './ai.evidence';
import { FakeModel, type FakeMode } from './ai.fake-model';
import { investigate } from './ai.investigator';
import { everyClaimResolves, type CitedResult } from './ai.schema';
import { AI_SETTINGS_DEFAULT } from './ai.settings.schema';
import type { NewRun } from './ai.store';

export interface GoldenFinding { title: string; citesKinds: string[] }
export interface GoldenFixture {
  name: string;
  description: string;
  now: string;
  sources: { incident: IncidentFacts; alerts: AlertFacts[]; changes: unknown[]; telemetry: TelemetryFacts | null; slos: SloFacts[]; similar: SimilarFacts[] };
  expect: {
    bundleKinds: string[];
    unavailable: string[];
    status?: 'EMPTY';
    noModelCall?: boolean;
    findings?: GoldenFinding[];
    minSummary?: number;
    promptMustNotContain?: string[];
  };
}

export interface EvalFailure { fixture: string; mode: string; check: string; detail: string }
export interface EvalReport { fixtures: number; runs: number; checks: number; failures: EvalFailure[] }

const TENANT = '00000000-0000-4000-8000-00000000000e';

export function sourcesFor(fx: GoldenFixture): EvidenceSources {
  const s = fx.sources;
  return {
    incident: async () => s.incident, alerts: async () => s.alerts, changes: async () => (s.changes as never), telemetry: async () => s.telemetry,
    slos: async () => s.slos, similar: async () => s.similar,
  };
}

interface Outcome { view: Awaited<ReturnType<typeof investigate>>; model: FakeModel; saved: NewRun[] }

async function runOnce(fx: GoldenFixture, mode: FakeMode): Promise<Outcome> {
  const model = new FakeModel(mode);
  const saved: NewRun[] = [];
  const view = await investigate({
    sources: sourcesFor(fx), model, settings: async () => ({ ...AI_SETTINGS_DEFAULT, enabled: true, providers: ['eval'], dailyCap: 100 }), countToday: async () => 0,
    save: (async (tenantId: string, run: NewRun) => { saved.push(run); return { noteId: `eval-${saved.length}`, tenantId, createdAt: new Date(fx.now), inputTokens: run.inputTokens ?? 0, outputTokens: run.outputTokens ?? 0, ...run }; }) as never,
    timeline: (async () => undefined) as never, now: () => new Date(fx.now),
  }, TENANT, fx.sources.incident.incidentId, { trigger: 'MANUAL' });
  return { view, model, saved };
}

export async function evaluateFixture(fx: GoldenFixture): Promise<{ checks: number; runs: number; failures: EvalFailure[] }> {
  const failures: EvalFailure[] = [];
  let checks = 0;
  const check = (mode: string, name: string, ok: boolean, detail = '') => { checks += 1; if (!ok) failures.push({ fixture: fx.name, mode, check: name, detail }); };

  const bundle = (await buildEvidenceBundle(sourcesFor(fx), TENANT, fx.sources.incident.incidentId, new Date(fx.now)))!;
  const kinds = [...new Set(bundle.items.map((i) => i.kind))].sort();
  check('bundle', 'evidence kinds', JSON.stringify(kinds) === JSON.stringify([...fx.expect.bundleKinds].sort()), `got ${kinds.join(',')}`);
  check('bundle', 'unavailable sources', JSON.stringify(bundle.unavailable) === JSON.stringify([...fx.expect.unavailable].sort()), `got ${bundle.unavailable.join(',')}`);
  check('bundle', 'ids are E1..En', bundle.items.every((i, n) => i.id === `E${n + 1}`));

  let runs = 0;
  const modes: FakeMode[] = ['faithful', 'fenced', 'hallucinating', 'garbage', 'badshape', 'injected'];
  for (const mode of modes) {
    const { view, model } = await runOnce(fx, mode); runs += 1;

    if (fx.expect.status === 'EMPTY') {
      check(mode, 'thin evidence is EMPTY', view.status === 'EMPTY', `status ${view.status}`);
      check(mode, 'no model call on thin evidence', model.calls.length === 0, `${model.calls.length} calls`);
      continue;
    }
    for (const forbidden of fx.expect.promptMustNotContain ?? []) check(mode, `prompt never contains "${forbidden}"`, !model.calls.some((c) => c.prompt.includes(forbidden)));

    if (mode === 'garbage' || mode === 'badshape') {
      check(mode, 'an unusable reply is a FAILED run with nothing stored', view.status === 'FAILED' && view.result === null, `status ${view.status}`);
      continue;
    }
    check(mode, 'run is OK', view.status === 'OK', `status ${view.status}`);
    if (view.status !== 'OK' || !view.result) continue;
    const result = view.result as unknown as CitedResult & { insufficient?: boolean };
    check(mode, 'every claim resolves to a stored evidence row', everyClaimResolves(result, { items: view.evidence as never }));

    if (mode === 'hallucinating') {
      const text = JSON.stringify(result);
      check(mode, 'invented claims are gone', !/ran out of disk|Thursdays|Disk exhaustion|real and a fake id/.test(text));
      check(mode, 'the drop is counted', result.dropped.claims >= 4 && result.dropped.hypotheses >= 1, JSON.stringify(result.dropped));
      continue;
    }
    if (mode === 'injected') {
      const planted = bundle.items.some((i) => /ignore previous instructions/i.test(`${i.title} ${i.detail}`));
      if (planted) check(mode, 'an obeyed injection yields no uncited claim and says so', result.summary.length === 0 && result.hypotheses.length === 0 && result.insufficient === true);
      else check(mode, 'without an injection the answer is the faithful one', result.summary.length >= (fx.expect.minSummary ?? 0));
      continue;
    }
    // faithful and fenced: the expected findings, each citing evidence of the expected kind
    check(mode, 'summary present', result.summary.length >= (fx.expect.minSummary ?? 0));
    const kindOf = new Map((view.evidence as Array<{ id: string; kind: string }>).map((e) => [e.id, e.kind]));
    for (const f of fx.expect.findings ?? []) {
      const h = result.hypotheses.find((x) => x.title.toLowerCase().includes(f.title));
      check(mode, `finding "${f.title}" present`, !!h, `have ${result.hypotheses.map((x) => x.title).join(' | ')}`);
      if (h) for (const k of f.citesKinds) check(mode, `finding "${f.title}" cites a ${k}`, h.claims.some((c) => c.evidence.some((id) => kindOf.get(id) === k)));
    }
    check(mode, 'no uncited claim was dropped from a faithful answer', result.dropped.claims === 0 && result.dropped.hypotheses === 0, JSON.stringify(result.dropped));
  }
  return { checks, runs, failures };
}

export async function runEval(fixtures: readonly GoldenFixture[]): Promise<EvalReport> {
  const report: EvalReport = { fixtures: fixtures.length, runs: 0, checks: 0, failures: [] };
  for (const fx of fixtures) {
    const r = await evaluateFixture(fx);
    report.runs += r.runs; report.checks += r.checks; report.failures.push(...r.failures);
  }
  return report;
}
