/**
 * The seam to the `ai` module (phase 20). The investigator, the drafts and the natural-language query never import a provider: they ask a
 * `ModelPort`. The real port calls `AIService.chat` with the tenant's id, so the call runs on the TENANT's own provider configuration (its
 * keys, its installed providers), under the plan and monthly-token gate `ai` applies, and is recorded in `ai`'s usage log like any other call.
 * `ai` is optional: without it (or without a configured provider) the port says it is unavailable and no feature starts.
 *
 * The provider is always named by the caller from the tenant's allow-list (`ai.settings.ts`); the port never picks one.
 */
import { loadAiPeer } from '../peers/peers';

export interface ModelRequest { systemPrompt: string; prompt: string; maxTokens: number; provider: string; model?: string }
export interface ModelReply { text: string; provider: string; model: string; inputTokens: number; outputTokens: number }

export interface ModelPort {
  /** Would a call be let through right now (module present, plan and quota allow it)? */
  available(tenantId: string): Promise<boolean>;
  complete(tenantId: string, req: ModelRequest): Promise<ModelReply>;
}

const load = (tenantId: string) => loadAiPeer(tenantId);

export const aiModuleModel: ModelPort = {
  async available(tenantId) {
    const svc = await load(tenantId);
    return svc ? svc.canComplete(tenantId) : false;
  },
  async complete(tenantId, req) {
    const svc = await load(tenantId);
    if (!svc) throw new Error('ai module not active');
    const r = await svc.chat(tenantId, { messages: [{ role: 'user', content: req.prompt }], systemPrompt: req.systemPrompt, maxTokens: req.maxTokens, temperature: 0, provider: req.provider, ...(req.model ? { model: req.model } : {}) });
    return { text: r.content, provider: r.provider, model: r.model, inputTokens: r.usage?.promptTokens ?? 0, outputTokens: r.usage?.completionTokens ?? 0 };
  },
};
