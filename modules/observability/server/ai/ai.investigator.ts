/**
 * The AI investigator (phase 20.2): advisory, OFF by default per tenant, never applies anything.
 *
 *   gate (switch, provider allow-list, daily cap, plan) -> evidence bundle -> prompt -> model -> strict parse -> citation filter -> store
 *
 * What is stored is only what survived the citation rule, together with the evidence it cites and how much was dropped. The timeline gets an
 * `AI_NOTE` event flagged AI-generated that points at the stored run. A failed call is recorded too (it counts against the cap and shows the
 * failure rate), but its raw provider message is not: only a short sentence of ours.
 */
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { scrubSecrets } from '../hygiene';
import { buildEvidenceBundle, type EvidenceSources } from './ai.evidence';
import { admitAiRun, type GateDeps } from './ai.gate';
import { INVESTIGATOR_PROMPT_VERSION, INVESTIGATOR_SYSTEM_PROMPT, investigatorUserPrompt } from './ai.prompt';
import { AiOutputError, enforceCitations, parseModelOutput } from './ai.schema';
import { runView, type AiRunView } from './ai.view';
import type { NewRun, saveRun, recordAiTimelineNote } from './ai.store';
import type { ModelPort } from './ai.model';

export const MIN_EVIDENCE_ITEMS = 2;
export const INVESTIGATOR_MAX_TOKENS = 1200;

export interface InvestigatorDeps extends GateDeps {
  sources: EvidenceSources;
  model: ModelPort;
  save?: typeof saveRun;
  timeline?: typeof recordAiTimelineNote;
  now?: () => Date;
}

export interface InvestigateOptions { trigger: 'MANUAL' | 'AUTO' | 'RESOLVE'; actorId?: string | null }

export async function investigate(deps: InvestigatorDeps, tenantId: string, incidentId: string, opts: InvestigateOptions): Promise<AiRunView> {
  const now = (deps.now ?? (() => new Date()))();
  // The store reaches the database; it is loaded only when no stand-in was given (the evaluation runner passes its own and needs no database).
  const store = deps.save && deps.timeline ? null : await import('./ai.store');
  const save = deps.save ?? store!.saveRun;
  const timeline = deps.timeline ?? store!.recordAiTimelineNote;
  const admission = await admitAiRun(deps, tenantId, now);

  const bundle = await buildEvidenceBundle(deps.sources, tenantId, incidentId, now);
  if (!bundle) throw new AppError('Incident not found', 404, ErrorCode.NOT_FOUND);

  const base: Pick<NewRun, 'incidentId' | 'kind' | 'trigger' | 'requestedBy' | 'promptVersion'> = {
    incidentId, kind: 'INVESTIGATION', trigger: opts.trigger, requestedBy: opts.actorId ?? null, promptVersion: INVESTIGATOR_PROMPT_VERSION,
  };

  // Nothing to reason from: say so, spend nothing.
  if (bundle.items.length < MIN_EVIDENCE_ITEMS) {
    const row = await save(tenantId, { ...base, status: 'EMPTY', result: { message: 'There is not enough evidence yet to analyse this incident.' }, evidence: bundle.items });
    await timeline(tenantId, incidentId, row, 'Not enough evidence to analyse yet', opts.actorId);
    return runView(row);
  }

  const prompt = scrubSecrets(investigatorUserPrompt(bundle));
  let reply;
  try {
    reply = await deps.model.complete(tenantId, { systemPrompt: INVESTIGATOR_SYSTEM_PROMPT, prompt, maxTokens: INVESTIGATOR_MAX_TOKENS, provider: admission.provider, model: admission.model });
  } catch (e) {
    // The logger reads the environment; it is loaded only when there is something to say (the evaluation runner needs no environment).
    void import('@kuraykaraaslan-labs/logger').then((m) => m.default.warn(`[ai.investigator] model call failed for ${incidentId}: ${e instanceof Error ? e.name : 'error'}`)).catch(() => undefined);
    const row = await save(tenantId, { ...base, status: 'FAILED', provider: admission.provider, model: admission.model ?? null, failure: 'The model call failed.', evidence: bundle.items });
    return runView(row);
  }

  const used = { provider: reply.provider, model: reply.model, inputTokens: reply.inputTokens, outputTokens: reply.outputTokens };
  let cited;
  try {
    cited = enforceCitations(parseModelOutput(reply.text), bundle);
  } catch (e) {
    const failure = e instanceof AiOutputError ? (e.kind === 'unparseable' ? 'The model reply was not valid JSON and was discarded.' : 'The model reply did not match the required shape and was discarded.') : 'The model reply could not be used.';
    const row = await save(tenantId, { ...base, ...used, status: 'FAILED', failure, evidence: bundle.items });
    return runView(row);
  }

  const insufficient = cited.summary.length === 0 && cited.hypotheses.length === 0;
  const citedIds = new Set([...cited.summary, ...cited.hypotheses.flatMap((h) => h.claims)].flatMap((c) => c.evidence));
  const row = await save(tenantId, {
    ...base, ...used, status: 'OK', evidence: bundle.items.filter((i) => citedIds.has(i.id) || i.kind === 'incident'),
    result: { ...cited, insufficient, unavailableSources: bundle.unavailable, evidenceCount: bundle.items.length },
  });
  await timeline(tenantId, incidentId, row, insufficient ? 'The analysis produced no cited findings' : (cited.summary[0]?.text ?? cited.hypotheses[0]?.title ?? 'Analysis added'), opts.actorId);
  return runView(row);
}
