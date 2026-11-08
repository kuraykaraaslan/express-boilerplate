/**
 * `registerGuardedTool`: the ONE place a tool reaches the SDK (gate S3, F18, F19). The composition order lives here, once:
 *
 *   filtered      a tool whose permission the caller does not hold now is never registered, so it is absent from `tools/list` and a
 *                 call to it is the SDK's `-32602` (the filtered strategy, D57-6); the handler below re-checks it anyway
 *   rateLimited   per credential and kind, through the shared limiter, fail CLOSED (machine lanes, LANE_POLICY)
 *   instrumented  one audit row per call (tool, outcome, duration, argument NAMES; never values or results, F15) and its signal
 *   run           the contributor's code, with the verified caller, validated input and an abort signal, under the time budget
 *   shaped        `structuredContent` (checked against the output schema) + the server's summary block + foreign text fenced in
 *                 blocks of its own (U1-U5); failures in the text block with `isError` (F20, R3); results over the cap refused (F17)
 *
 * Contributors never call this; mcp_server.server builds a server per request and calls it for each tool of the module.
 */
import type { McpServer } from '@modelcontextprotocol/server';
import type { McpCaller, McpToolDefinition, McpToolKind } from '@kuraykaraaslan-labs/common/server/common.mcp-contracts';
import { fenced } from './mcp_server.fenced';
import { MAX_MCP_RESULT_BYTES, MCP_TOOL_TIMEOUT_MS } from './mcp_server.protocol';

/**
 * Gate R1: the first result of a keyed call, held for IDEMPOTENCY_KEY_TTL under `idem:{tenantId}:{credentialId}:{server}:{tool}:{key}`
 * (the credential is part of the key, so one caller's retry can never be answered with another caller's result). Fails CLOSED: a store
 * that cannot answer refuses the call.
 */
export interface IdempotencyStore {
  /** `reserved` when this call is the first; the stored result for a repeat; `pending` while the first is still running. */
  reserve(key: string): Promise<'reserved' | 'pending' | { result: ShapedResult }>;
  complete(key: string, result: ShapedResult): Promise<void>;
  release(key: string): Promise<void>;
}

/** The envelope's codes (error-envelope-and-idempotency.md §2): the contributor's plus the host's own. */
export type McpErrorCode =
  | 'VALIDATION_ERROR' | 'NOT_FOUND' | 'CONFLICT' | 'PRECONDITION_FAILED' | 'FORBIDDEN' | 'UPSTREAM_ERROR'
  | 'RATE_LIMITED' | 'TIMEOUT' | 'INTERNAL_ERROR';

export type ToolOutcome = 'ok' | 'error' | 'rate_limited' | 'timeout' | 'denied';

export interface ToolCallRecord {
  moduleId: string;
  tool: string;
  kind: McpToolKind;
  outcome: ToolOutcome;
  code?: McpErrorCode;
  durationMs: number;
  argKeys: string[];
}

export interface ToolCallDeps {
  /** Resolves when the caller may make one more call of this kind; resolves `false` when its budget is spent. */
  admit(caller: McpCaller, kind: McpToolKind): Promise<boolean>;
  /** One record per call. Never throws into the call. */
  audit(caller: McpCaller, rec: ToolCallRecord): Promise<void>;
  /** Server-side diagnostics of an unexpected failure (never sent to the client). */
  report(error: unknown, rec: Omit<ToolCallRecord, 'outcome' | 'durationMs'>): void;
  /** The idempotency store of keyed tools (required once a tool declares `idempotency: 'key'`). */
  idempotency?: IdempotencyStore;
  now?: () => number;
  timeoutMs?: number;
}

type TextBlock = { type: 'text'; text: string };
export type ShapedResult = { content: TextBlock[]; structuredContent?: Record<string, unknown>; isError?: true };

/** The error envelope, in the text block only, with `isError` and no `structuredContent` (F20, R3). `details` is allowlisted scalars (R4). */
export function toolError(
  code: McpErrorCode, message: string, retryable = false, details?: Record<string, string | number | boolean>,
): ShapedResult {
  const safeDetails = details
    ? Object.fromEntries(Object.entries(details).filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v)).slice(0, 20))
    : undefined;
  return { content: [{ type: 'text', text: JSON.stringify({ code, message: message.slice(0, 500), retryable, ...(safeDetails ? { details: safeDetails } : {}) }) }], isError: true };
}

class ToolTimeout extends Error {}

function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>, ms: number, outer?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const onOuter = () => controller.abort(outer?.reason);
  if (outer) { if (outer.aborted) controller.abort(outer.reason); else outer.addEventListener('abort', onOuter, { once: true }); }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(new ToolTimeout()); reject(new ToolTimeout()); }, ms);
  });
  return Promise.race([work(controller.signal), timeout]).finally(() => {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onOuter);
  });
}

/** Runs one call through the composition (exported for the tests; the SDK handler below is a thin adapter over it). */
export async function runGuardedCall(
  moduleId: string, tool: McpToolDefinition, caller: McpCaller, granted: ReadonlySet<string>, args: Record<string, unknown>,
  deps: ToolCallDeps, outerSignal?: AbortSignal,
): Promise<ShapedResult> {
  const now = deps.now ?? Date.now;
  const started = now();
  const base = { moduleId, tool: tool.name, kind: tool.kind, argKeys: Object.keys(args ?? {}).slice(0, 50) };
  const finish = (outcome: ToolOutcome, result: ShapedResult, code?: McpErrorCode): ShapedResult => {
    void deps.audit(caller, { ...base, outcome, ...(code ? { code } : {}), durationMs: Math.max(0, now() - started) }).catch(() => undefined);
    return result;
  };

  // Defence in depth: the filtered registration already left this tool out when the permission is not held.
  if (!granted.has(tool.permission)) return finish('denied', toolError('FORBIDDEN', 'This credential may not use this tool.'), 'FORBIDDEN');

  let admitted: boolean;
  try { admitted = await deps.admit(caller, tool.kind); } catch { admitted = false; }
  if (!admitted) return finish('rate_limited', toolError('RATE_LIMITED', 'Rate limit reached for this credential; retry later.', true), 'RATE_LIMITED');

  // R1: a keyed call runs once; a repeat with the same key answers the first result, a concurrent one waits its turn.
  let idemKey: string | null = null;
  if (tool.idempotency === 'key') {
    const raw = (args as { idempotencyKey?: unknown }).idempotencyKey;
    if (typeof raw !== 'string' || raw.length < 1 || raw.length > 200 || !deps.idempotency) {
      return finish('error', toolError('VALIDATION_ERROR', 'idempotencyKey is required.'), 'VALIDATION_ERROR');
    }
    idemKey = `idem:${caller.tenantId}:${caller.credentialId}:${moduleId}:${tool.name}:${raw}`;
    let state: Awaited<ReturnType<IdempotencyStore['reserve']>>;
    try { state = await deps.idempotency.reserve(idemKey); } catch {
      return finish('error', toolError('INTERNAL_ERROR', 'The call could not be made safely; retry later.', true), 'INTERNAL_ERROR');
    }
    if (state === 'pending') return finish('error', toolError('CONFLICT', 'A call with this idempotencyKey is still running; retry later.', true), 'CONFLICT');
    if (state !== 'reserved') return finish('ok', state.result);
  }
  const done = (outcome: ToolOutcome, shaped: ShapedResult, code?: McpErrorCode): ShapedResult => {
    // A timeout leaves the outcome unknown: the key stays pending, so a retry with it is refused rather than run twice.
    if (idemKey && deps.idempotency && outcome !== 'timeout') {
      const store = deps.idempotency;
      void (outcome === 'ok' ? store.complete(idemKey, shaped) : store.release(idemKey)).catch(() => undefined);
    }
    return finish(outcome, shaped, code);
  };

  let result: Awaited<ReturnType<McpToolDefinition['run']>>;
  try {
    result = await withTimeout((signal) => tool.run({ caller, signal }, args as never), deps.timeoutMs ?? MCP_TOOL_TIMEOUT_MS, outerSignal);
  } catch (error) {
    if (error instanceof ToolTimeout) {
      return done('timeout', toolError('TIMEOUT', 'The tool did not answer in time; the outcome is unknown.', true), 'TIMEOUT');
    }
    deps.report(error, base);
    return done('error', toolError('INTERNAL_ERROR', 'The tool failed.'), 'INTERNAL_ERROR');
  }

  if (!result.ok) return done('error', toolError(result.code, result.message, result.retryable ?? false, result.details), result.code);

  const checked = tool.output.safeParse(result.data);
  if (!checked.success) {
    deps.report(new Error(`output does not match the schema: ${checked.error.issues.slice(0, 3).map((i) => i.path.join('.')).join(', ')}`), base);
    return done('error', toolError('INTERNAL_ERROR', 'The tool failed.'), 'INTERNAL_ERROR');
  }

  const blocks = (result.foreign ?? []).slice(0, 50).map((f) => fenced(f.source, f.text));
  const anyTruncated = blocks.some((b) => b.truncated);
  const summary = `${result.summary.slice(0, 1000)}${anyTruncated ? ' Some quoted text was truncated.' : ''}`;
  const shaped: ShapedResult = {
    content: [{ type: 'text', text: summary }, ...blocks.map(({ type, text }) => ({ type, text }))],
    structuredContent: checked.data as Record<string, unknown>,
  };
  if (Buffer.byteLength(JSON.stringify(shaped), 'utf8') > MAX_MCP_RESULT_BYTES) {
    return done('error', toolError('VALIDATION_ERROR', 'The result is too large; ask for fewer rows (a smaller limit or the next page).'), 'VALIDATION_ERROR');
  }
  return done('ok', shaped);
}

/**
 * Registers one tool on a per-request server when the caller holds its permission now. Returns whether it was registered.
 * The only `server.registerTool` call site of the platform (gate S3).
 */
export function registerGuardedTool(
  server: McpServer, moduleId: string, tool: McpToolDefinition, caller: McpCaller, granted: ReadonlySet<string>, deps: ToolCallDeps,
): boolean {
  if (!granted.has(tool.permission)) return false;
  server.registerTool(
    tool.name,
    { title: tool.title, description: tool.description, inputSchema: tool.input, outputSchema: tool.output, annotations: { title: tool.title, ...tool.annotations } },
    async (args: Record<string, unknown>, ctx: unknown) =>
      runGuardedCall(moduleId, tool, caller, granted, args, deps, (ctx as { mcpReq?: { signal?: AbortSignal } } | undefined)?.mcpReq?.signal),
  );
  return true;
}
