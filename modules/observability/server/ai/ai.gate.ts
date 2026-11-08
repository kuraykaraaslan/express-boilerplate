/**
 * Everything that must be true before an AI feature may cost a tenant anything or send its data anywhere (phase 20), checked cheapest first
 * and all failing CLOSED, in the manner of the `ai_agent` guardrails: the tenant's own switch, a provider on its allow-list, today's
 * remaining allowance, then the plan and token quota `ai` enforces. Nothing is read, built or sent before this passes.
 */
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import type { AiSettings } from './ai.settings.schema';
import type { ModelPort } from './ai.model';

export interface GateDeps {
  settings(tenantId: string): Promise<AiSettings>;
  countToday(tenantId: string, now: Date): Promise<number>;
  model: ModelPort;
}

/** Why a run was refused, as a code a screen can word in its own language (`AppError.details.reason`). */
export type GateRefusal = 'ai_off' | 'no_provider' | 'daily_cap' | 'provider_unavailable';

export interface Admission { provider: string; model?: string; remaining: number; settings: AiSettings }

export async function admitAiRun(deps: GateDeps, tenantId: string, now: Date): Promise<Admission> {
  const settings = await deps.settings(tenantId);
  if (!settings.enabled) throw new AppError('AI assistance is off for this workspace', 403, ErrorCode.FEATURE_NOT_AVAILABLE, { details: { reason: 'ai_off' satisfies GateRefusal } });
  const provider = settings.providers[0];
  if (!provider) throw new AppError('No AI provider is allowed in the AI settings of this workspace', 409, ErrorCode.CONFLICT, { details: { reason: 'no_provider' satisfies GateRefusal } });
  // A cap of zero means "nothing today", not "unlimited".
  const spent = await deps.countToday(tenantId, now);
  if (spent >= settings.dailyCap) throw new AppError('The daily AI limit of this workspace is used up', 429, ErrorCode.RATE_LIMIT_EXCEEDED, { retryable: false, details: { reason: 'daily_cap' satisfies GateRefusal } });
  if (!(await deps.model.available(tenantId))) throw new AppError('The AI provider is not available (not installed, not configured, or the plan or token quota refuses it)', 503, ErrorCode.FEATURE_NOT_AVAILABLE, { details: { reason: 'provider_unavailable' satisfies GateRefusal } });
  return { provider, ...(settings.model ? { model: settings.model } : {}), remaining: settings.dailyCap - spent, settings };
}
