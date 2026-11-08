/**
 * The MCP tool contract (docs/phases/57-mcp-server, D57-4; ADR-0022): what a module contributes to `mcp_server:tool` so its records can
 * be read (and later changed) by an MCP host on behalf of a person, with that person's rights and nothing more.
 *
 * A contributor imports THIS file, never `mcp_server` and never the MCP SDK (the firewall's rule, ADR-0008 §2): it default-exports one
 * `defineMcpTool(...)` or an array of them from its own folder (`server/<module>.mcp-tools.ts`) and lists the names in its manifest
 * contribution (`metadata.ids`). The host builds one MCP server per contributing module (`/api/mcp/<moduleId>`) from them.
 *
 * What a contributor never writes, because the host owns it (gate S3, F6, F18): authentication, the permission check, rate limits,
 * audit, timeouts, the result size cap, the error envelope, the content blocks and the fencing of foreign text. A tool's `run` gets an
 * already-verified caller whose permission was checked, validated input, and an abort signal; it returns `mcpOk(...)` or `mcpFail(...)`.
 *
 * Every rule below is checked at boot by the `mcp-tools` guard (the host module's registry), which refuses to start on a violation.
 */
import { z } from 'zod';

/** MCP_Server_Design_Rules tool-naming-conventions.md §1.2 (gate T1). */
export const MCP_TOOL_NAME_RE = /^[a-z][a-z0-9_]*$/;
export const MCP_TOOL_NAME_MAX = 48;
/** §4.2: the hard cap; aim for 400. */
export const MCP_TOOL_DESCRIPTION_MAX = 600;
/** §4.1: the literal markers every description carries (gate T2). `Precondition: none.` / `Errors: none.` are the empty forms. */
export const MCP_DESCRIPTION_MARKERS = ['Precondition:', 'Output:', 'Errors:'] as const;

/** §2.1: the approved verbs. Extend here, deliberately, never in a tool file. */
export const MCP_TOOL_VERBS: ReadonlySet<string> = new Set([
  'list', 'get', 'search', 'count', 'download', 'export', 'validate', 'analyze', 'render',
  'create', 'upload', 'copy', 'update', 'delete', 'move', 'assign', 'approve', 'cancel',
  'close', 'publish', 'send', 'retry', 'sync',
]);
/** §3.4: verbs that only read. */
export const MCP_READ_VERBS: ReadonlySet<string> = new Set(['list', 'get', 'search', 'count', 'download', 'validate', 'analyze', 'render']);
/** §3.4 / error-envelope §5.9 (gate R1): verbs whose retry duplicates work; the input must carry a required `idempotencyKey`. */
export const MCP_KEYED_VERBS: ReadonlySet<string> = new Set(['create', 'upload', 'send', 'publish']);

/** `read` tools may only read; `write` tools change records and run only after 57.6 (MO-3). */
export type McpToolKind = 'read' | 'write';

/**
 * Hints for the host's UI (gate T3). Never an authorization input on either side (F8). Read tools: `readOnlyHint: true` and an explicit
 * `openWorldHint`, the other two omitted. Write tools: all four explicit; `idempotentHint: true` only with an idempotency key or a
 * version guard the tool enforces.
 */
export interface McpToolAnnotations {
  readOnlyHint: boolean;
  openWorldHint: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
}

/** Who the call is for. The person's rights are the ceiling of every tool (phase 48 D48-4); the tenant comes from the credential only. */
export interface McpCaller {
  tenantId: string;
  /** The person the credential acts as: the API key's holder (D48-2), or the person who consented (OAuth, 57.3). */
  userId: string;
  /** How the caller authenticated. */
  via: 'api_key' | 'oauth';
  /** The API key id or the OAuth grant id: what limits, audit and the firewall's actions bind to. */
  credentialId: string;
  /** The role the person acts with here (an OWNER acts as ADMIN through a credential), for a module's own record rules. */
  memberRole?: string;
}

export interface McpToolContext {
  caller: McpCaller;
  /** Aborted when the host's time budget runs out or the client goes away; pass it to long reads. */
  signal: AbortSignal;
}

/** error-envelope-and-idempotency.md §2: the codes a tool may fail with. The host adds UNAUTHORIZED, RATE_LIMITED, TIMEOUT and INTERNAL_ERROR. */
export type McpToolErrorCode = 'VALIDATION_ERROR' | 'NOT_FOUND' | 'CONFLICT' | 'PRECONDITION_FAILED' | 'FORBIDDEN' | 'UPSTREAM_ERROR';

/** Text this server did not author (a title, a comment, a file name): shown to the model fenced as untrusted, never inside our sentence (U1-U5). */
export interface McpForeignText {
  /** Where it comes from, e.g. `tasks/<taskId>`. */
  source: string;
  text: string;
}

export type McpToolResult<O> =
  | {
    ok: true;
    /** One sentence the server writes (no foreign text in it): what was found. The first content block. */
    summary: string;
    /** The success shape (`output`); it becomes `structuredContent`. Foreign strings may sit here raw (U5). */
    data: O;
    /** Foreign text for the model, each fenced in its own block after the summary. */
    foreign?: McpForeignText[];
  }
  | { ok: false; code: McpToolErrorCode; message: string; retryable?: boolean; details?: Record<string, string | number | boolean> };

type AnyObject = z.ZodObject<z.ZodRawShape>;

export interface McpToolDefinition<In extends AnyObject = AnyObject, Out extends AnyObject = AnyObject> {
  /** `{verb}_{noun}` with an approved verb, ≤ 48 characters, unique within the module's server. */
  name: string;
  /** A short human title for host UIs. */
  title: string;
  /** House format: one sentence, then `Precondition:`, `Output:`, `Errors:`; ≤ 600 characters. */
  description: string;
  kind: McpToolKind;
  /**
   * The permission of the CONTRIBUTING module that this tool needs, exactly as its own routes check it (`tasks.tasks.read`). It must be
   * one an API key may hold (phase 48 D48-3), and a `write` tool's must not be a read permission.
   */
  permission: string;
  /** The arguments, a Zod object; validated before `run` is called. */
  input: In;
  /** The success shape only, a Zod object (never a union with an error, F20). */
  output: Out;
  annotations: McpToolAnnotations;
  /** Required for the keyed verbs (and then `input` has an `idempotencyKey`); `version` for an update with a version guard. */
  idempotency?: 'key' | 'version';
  run(ctx: McpToolContext, input: z.infer<In>): Promise<McpToolResult<z.infer<Out>>>;
}

/**
 * The registration call of a contributor: returns the definition unchanged, typed, so `run`'s input and result follow the schemas.
 *
 *   export default [
 *     defineMcpTool({ name: 'list_tasks', kind: 'read', permission: 'tasks.tasks.read', input, output, ..., run: async (ctx, input) => ... }),
 *   ];
 */
export function defineMcpTool<In extends AnyObject, Out extends AnyObject>(def: McpToolDefinition<In, Out>): McpToolDefinition<In, Out> {
  return Object.freeze(def);
}

export function mcpOk<O>(summary: string, data: O, foreign?: McpForeignText[]): McpToolResult<O> {
  return { ok: true, summary, data, ...(foreign && foreign.length > 0 ? { foreign } : {}) };
}

export function mcpFail(
  code: McpToolErrorCode, message: string, opts: { retryable?: boolean; details?: Record<string, string | number | boolean> } = {},
): McpToolResult<never> {
  return { ok: false, code, message, ...opts };
}

/** The contribution's default export. */
export type McpToolContribution = McpToolDefinition | readonly McpToolDefinition[];
