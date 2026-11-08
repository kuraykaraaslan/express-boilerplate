/**
 * The shared tail of every model-backed feature other than the investigator (drafts, natural-language query): call the model through the
 * port, and turn a provider failure into a stored FAILED run with a sentence of ours (never the provider's own text).
 */
import Logger from '@kuraykaraaslan-labs/logger';
import type { Admission } from './ai.gate';
import type { ModelPort, ModelReply } from './ai.model';
import { runView, saveRun, type AiRunView, type NewRun } from './ai.store';

export interface RunDeps { model: ModelPort; save?: typeof saveRun }

export async function callOrFail(
  deps: RunDeps, tenantId: string, admission: Admission, req: { systemPrompt: string; prompt: string; maxTokens: number }, base: Omit<NewRun, 'status'>,
): Promise<{ reply: ModelReply } | { failed: AiRunView }> {
  try {
    return { reply: await deps.model.complete(tenantId, { ...req, provider: admission.provider, model: admission.model }) };
  } catch (e) {
    Logger.warn(`[ai.run] ${base.kind} model call failed: ${e instanceof Error ? e.name : 'error'}`);
    const row = await (deps.save ?? saveRun)(tenantId, { ...base, status: 'FAILED', provider: admission.provider, model: admission.model ?? null, failure: 'The model call failed.' });
    return { failed: runView(row) };
  }
}

export const usedBy = (r: ModelReply) => ({ provider: r.provider, model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens });
