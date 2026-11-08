/**
 * The mapping from NB's own model calls to the OpenTelemetry GenAI semantic conventions (phase 20.6), as pure functions.
 *
 * VERSION PIN. Every GenAI convention is in status "Development" and attribute names have changed between releases, so this file is written
 * against ONE revision and says which: the GenAI conventions now live in `open-telemetry/semantic-conventions-genai` and reference the core
 * semantic conventions at v1.44.0. The attribute names below were read from `docs/gen-ai/gen-ai-spans.md`, `client-inference.md` and
 * `gen-ai-agent-spans.md` at commit f49da22 (2026-10-17). A change of revision is a deliberate edit of `GENAI_SEMCONV` and of the golden
 * test beside it, never a drift.
 *
 * Deliberately NOT emitted: message content (`gen_ai.input.messages`, `gen_ai.output.messages`, `gen_ai.system_instructions`,
 * `gen_ai.tool.definitions`). They are Opt-In in the convention and carry prompts, which can hold personal data; NB's hook never receives them.
 * `gen_ai.response.finish_reasons` is an array in the convention and the tracing facade takes scalar attributes only, so it is left out.
 */
import type { AiCallMeta } from '../peers/peers.types';

export const GENAI_SEMCONV = {
  semconvVersion: '1.44.0',
  repository: 'open-telemetry/semantic-conventions-genai',
  status: 'Development',
  readAtCommit: 'f49da22056925ae9ba78ec5dd7fe1fa559adce05',
  readOn: '2026-10-17',
} as const;

export const GEN_AI = {
  operationName: 'gen_ai.operation.name',
  providerName: 'gen_ai.provider.name',
  requestModel: 'gen_ai.request.model',
  requestMaxTokens: 'gen_ai.request.max_tokens',
  requestTemperature: 'gen_ai.request.temperature',
  requestTopP: 'gen_ai.request.top_p',
  requestStream: 'gen_ai.request.stream',
  responseModel: 'gen_ai.response.model',
  usageInputTokens: 'gen_ai.usage.input_tokens',
  usageOutputTokens: 'gen_ai.usage.output_tokens',
  conversationId: 'gen_ai.conversation.id',
  agentName: 'gen_ai.agent.name',
  errorType: 'error.type',
} as const;

/** The `gen_ai.operation.name` values the explorer understands (the well-known values of the pinned revision that NB or a tenant app is likely to emit). */
export const GEN_AI_OPERATIONS = ['chat', 'text_completion', 'embeddings', 'generate_content', 'invoke_agent', 'execute_tool', 'retrieval'] as const;

/** Provider keys NB knows, mapped to the convention's well-known `gen_ai.provider.name` values; any other key is passed through (a custom value is allowed). */
const PROVIDER_NAMES: Record<string, string> = { openai: 'openai', anthropic: 'anthropic', google: 'gcp.gemini', azure: 'azure.ai.openai', mistral: 'mistral_ai', cohere: 'cohere' };

export const providerName = (key: string): string => PROVIDER_NAMES[key] ?? key;

export type GenAiAttributes = Record<string, string | number | boolean>;

export interface GenAiSpanStart { name: string; kind: 'CLIENT'; attributes: GenAiAttributes }

/** What is known at span creation time (the convention asks for operation, provider and model here, because sampling decisions use them). */
export function spanStartFor(meta: AiCallMeta): GenAiSpanStart {
  const operation = meta.operation === 'embed' ? 'embeddings' : 'chat';
  const attributes: GenAiAttributes = { [GEN_AI.operationName]: operation, [GEN_AI.providerName]: providerName(meta.provider) };
  if (meta.model) attributes[GEN_AI.requestModel] = meta.model;
  if (meta.maxTokens !== undefined) attributes[GEN_AI.requestMaxTokens] = meta.maxTokens;
  if (meta.temperature !== undefined) attributes[GEN_AI.requestTemperature] = meta.temperature;
  if (meta.topP !== undefined) attributes[GEN_AI.requestTopP] = meta.topP;
  if (meta.operation === 'stream') attributes[GEN_AI.requestStream] = true;
  return { name: meta.model ? `${operation} ${meta.model}` : operation, kind: 'CLIENT', attributes };
}

export interface AiOutcomeLike {
  model?: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}

/** What is known once the call returned. An embeddings response only reports a total, which is its input. */
export function spanEndFor(meta: AiCallMeta, outcome: AiOutcomeLike): GenAiAttributes {
  const a: GenAiAttributes = {};
  if (outcome.model) a[GEN_AI.responseModel] = outcome.model;
  const u = outcome.usage;
  if (u) {
    const input = meta.operation === 'embed' ? u.totalTokens : u.promptTokens;
    if (typeof input === 'number') a[GEN_AI.usageInputTokens] = input;
    if (meta.operation !== 'embed' && typeof u.completionTokens === 'number') a[GEN_AI.usageOutputTokens] = u.completionTokens;
  }
  return a;
}

/** Low-cardinality `error.type`: the error's class name, never its message (which can carry a prompt fragment or a key). */
export function errorTypeOf(e: unknown): string {
  const name = e instanceof Error ? e.name : '';
  return name && name !== 'Error' ? name.slice(0, 80) : '_OTHER';
}
