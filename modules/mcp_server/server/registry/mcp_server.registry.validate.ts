/**
 * The checks the `mcp-tools` boot guard runs over every `mcp_server:tool` contribution (docs/phases/57-mcp-server D57-5). Pure: the
 * contributions and the permission catalogue come in, a verdict goes out. A problem refuses the boot (gates T1-T4, R1, S3 at boot,
 * not at review time).
 */
import {
  MCP_DESCRIPTION_MARKERS,
  MCP_KEYED_VERBS,
  MCP_READ_VERBS,
  MCP_TOOL_DESCRIPTION_MAX,
  MCP_TOOL_NAME_MAX,
  MCP_TOOL_NAME_RE,
  MCP_TOOL_VERBS,
  type McpToolDefinition,
} from '@kuraykaraaslan-labs/common/server/common.mcp-contracts';

/** MO-3 / 57.6: write tools are accepted, with an idempotency key (create) or a version guard (update). */
export const WRITE_TOOLS_ENABLED = true;

/**
 * D57-21: the write verbs a tool may use without a person approving each call. Every other write verb (delete, move, assign, approve,
 * cancel, close, publish, send, upload, copy, sync, retry) waits for an approval mode, because a model talked into it by injected text
 * would act at once.
 */
export const DIRECT_WRITE_VERBS: ReadonlySet<string> = new Set(['create', 'update']);

/** Path segments under /api/mcp that are not servers (the OAuth endpoints, the grants list). */
export const RESERVED_SERVER_IDS: ReadonlySet<string> = new Set(['oauth', 'grants']);

/** tool-naming-conventions.md §2.2: coined synonyms are errors, generic verbs too, and `get_all_*` is a `list`. */
const SYNONYMS: Readonly<Record<string, string>> = {
  fetch: 'get', retrieve: 'get', read: 'get', load: 'get', find: 'search', query: 'search', filter: 'search', lookup: 'search',
  remove: 'delete', destroy: 'delete', purge: 'delete', drop: 'delete', add: 'create', insert: 'create', make: 'create',
  new: 'create', register: 'create', modify: 'update', edit: 'update', patch: 'update', put: 'update', set: 'update', change: 'update',
};
const GENERIC: ReadonlySet<string> = new Set(['do', 'run', 'execute', 'handle', 'process', 'perform', 'manage', 'call']);

export interface PermissionFacts {
  moduleId: string;
  /** Phase 48 D48-3: a permission an API key may hold. */
  keyGrantable: boolean;
  readOnly: boolean;
}

export interface LoadedToolContribution {
  contributionId: string;
  moduleId: string;
  /** The manifest's `metadata.ids`, or null when absent or malformed. */
  ids: string[] | null;
  impl: unknown;
}

export interface ToolRegistryInput {
  loaded: LoadedToolContribution[];
  failed: { contributionId: string; message: string }[];
  permissionOf: (permissionId: string) => PermissionFacts | undefined;
}

export interface ToolRegistryProblem {
  contributionId: string;
  tool?: string;
  message: string;
}

export interface ToolRegistryVerdict {
  ok: boolean;
  problems: ToolRegistryProblem[];
  /** Per contributing module, its tools sorted by name (4.10: deterministic `tools/list`). Only tools that passed. */
  catalog: ReadonlyMap<string, readonly McpToolDefinition[]>;
}

interface ZodLike { _zod?: { def?: { type?: string } }; shape?: Record<string, unknown>; safeParse?: unknown }
const isZodObject = (s: unknown): s is ZodLike & { shape: Record<string, unknown> } =>
  !!s && typeof s === 'object' && (s as ZodLike)._zod?.def?.type === 'object' && typeof (s as ZodLike).safeParse === 'function'
  && !!(s as ZodLike).shape;

/** Every problem of one tool definition (empty when it passes). */
export function toolProblems(moduleId: string, def: unknown, permissionOf: ToolRegistryInput['permissionOf']): string[] {
  const out: string[] = [];
  if (!def || typeof def !== 'object') return ['is not a tool definition (defineMcpTool)'];
  const t = def as Partial<McpToolDefinition>;
  const name = typeof t.name === 'string' ? t.name : '';

  // T1: the name.
  if (!MCP_TOOL_NAME_RE.test(name)) out.push(`name must match ${String(MCP_TOOL_NAME_RE)}`);
  if (name.length > MCP_TOOL_NAME_MAX) out.push(`name is ${name.length} characters, max ${MCP_TOOL_NAME_MAX}`);
  const head = name.split('_').slice(0, 2);
  for (const token of head) {
    if (GENERIC.has(token)) out.push(`"${token}" is a generic verb: name the real action`);
    if (SYNONYMS[token]) out.push(`"${token}" is a synonym of "${SYNONYMS[token]}"`);
  }
  if (name.startsWith('get_all') || name.startsWith('fetch_all')) out.push('a collection read is list_*, never get_all_*');
  const verb = head.find((token) => MCP_TOOL_VERBS.has(token));
  if (!verb) out.push(`no approved verb in "${head.join('_')}"`);

  // T2: title and description.
  if (typeof t.title !== 'string' || t.title.trim() === '' || t.title.length > 80) out.push('title must be 1..80 characters');
  const description = typeof t.description === 'string' ? t.description : '';
  if (description.length < 20) out.push('description is missing or too short');
  if (description.length > MCP_TOOL_DESCRIPTION_MAX) out.push(`description is ${description.length} characters, max ${MCP_TOOL_DESCRIPTION_MAX}`);
  for (const marker of MCP_DESCRIPTION_MARKERS) {
    if (!description.includes(marker)) out.push(`description is missing "${marker}" ("${marker} none." when there is none)`);
  }

  // Kind against the verb.
  if (t.kind !== 'read' && t.kind !== 'write') out.push('kind must be read or write');
  if (verb && t.kind === 'read' && !MCP_READ_VERBS.has(verb)) out.push(`"${verb}" is not a read verb, so the tool cannot be kind read`);
  if (verb && t.kind === 'write' && MCP_READ_VERBS.has(verb)) out.push(`"${verb}" is a read verb, so the tool cannot be kind write`);
  if (t.kind === 'write' && !WRITE_TOOLS_ENABLED) out.push('write tools are not accepted yet (read-only first, MO-3)');
  if (t.kind === 'write' && verb && !DIRECT_WRITE_VERBS.has(verb)) out.push(`"${verb}" needs a person to approve each call; only create and update tools are accepted (D57-21)`);
  if (t.kind === 'write' && verb === 'update' && t.idempotency !== 'version') out.push(`"update" needs idempotency: 'version' (an expectedVersion the tool checks, R2)`);
  if (t.kind === 'write' && verb === 'create' && t.annotations?.destructiveHint !== false) out.push('a create tool sets destructiveHint: false');

  // T4: schemas.
  if (!isZodObject(t.input)) out.push('input must be a Zod object schema');
  if (!isZodObject(t.output)) out.push('output must be a Zod object schema (the success shape only)');
  const inputKeys = isZodObject(t.input) ? Object.keys(t.input.shape) : [];

  // T3: annotations.
  const a = t.annotations;
  if (!a || typeof a !== 'object') out.push('annotations are required');
  else if (t.kind === 'read') {
    if (a.readOnlyHint !== true) out.push('a read tool sets readOnlyHint: true');
    if (typeof a.openWorldHint !== 'boolean') out.push('a read tool sets openWorldHint explicitly');
    if (a.destructiveHint !== undefined || a.idempotentHint !== undefined) out.push('a read tool omits destructiveHint and idempotentHint');
  } else if (t.kind === 'write') {
    for (const k of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'] as const) {
      if (typeof a[k] !== 'boolean') out.push(`a write tool sets ${k} explicitly`);
    }
    if (a.readOnlyHint !== false) out.push('a write tool sets readOnlyHint: false');
    if (a.idempotentHint === true && !t.idempotency) out.push('idempotentHint: true needs idempotency key or version');
  }

  // R1 / R2: idempotency.
  if (verb && MCP_KEYED_VERBS.has(verb) && t.idempotency !== 'key') out.push(`"${verb}" needs idempotency: 'key'`);
  if (t.idempotency === 'key' && !inputKeys.includes('idempotencyKey')) out.push('idempotency key: input needs an idempotencyKey');
  if (t.idempotency === 'version' && !inputKeys.includes('expectedVersion')) out.push('idempotency version: input needs an expectedVersion');
  if (t.idempotency !== undefined && t.idempotency !== 'key' && t.idempotency !== 'version') out.push('idempotency is key or version');

  // The permission (D57-4, D57-6): the contributor's own, one a key may hold, and not a read permission on a write tool.
  const permission = typeof t.permission === 'string' ? t.permission : '';
  const facts = permission ? permissionOf(permission) : undefined;
  if (!facts) out.push(`permission "${permission}" is not in any manifest`);
  else {
    if (facts.moduleId !== moduleId) out.push(`permission "${permission}" belongs to ${facts.moduleId}, not to ${moduleId}`);
    if (!facts.keyGrantable) out.push(`permission "${permission}" is one no API key may hold (phase 48 D48-3)`);
    if (t.kind === 'write' && facts.readOnly) out.push(`permission "${permission}" is a read permission on a write tool`);
  }

  if (typeof t.run !== 'function') out.push('run must be a function');
  return out;
}

export function validateToolRegistry(input: ToolRegistryInput): ToolRegistryVerdict {
  const problems: ToolRegistryProblem[] = input.failed.map((f) => ({ contributionId: f.contributionId, message: `cannot be loaded: ${f.message}` }));
  const byModule = new Map<string, McpToolDefinition[]>();

  for (const c of input.loaded) {
    if (RESERVED_SERVER_IDS.has(c.moduleId)) problems.push({ contributionId: c.contributionId, message: `a module named ${c.moduleId} cannot have an MCP server (the path is taken)` });
    const defs: unknown[] = Array.isArray(c.impl) ? c.impl : [c.impl];
    const names: string[] = [];
    let contributionOk = true;
    for (const def of defs) {
      const name = def && typeof def === 'object' && typeof (def as { name?: unknown }).name === 'string' ? (def as { name: string }).name : '?';
      names.push(name);
      const own = toolProblems(c.moduleId, def, input.permissionOf);
      if (own.length > 0) {
        contributionOk = false;
        for (const message of own) problems.push({ contributionId: c.contributionId, tool: name, message });
        continue;
      }
      const list = byModule.get(c.moduleId) ?? [];
      if (list.some((d) => d.name === name)) {
        contributionOk = false;
        problems.push({ contributionId: c.contributionId, tool: name, message: `tool "${name}" is registered twice for ${c.moduleId}` });
        continue;
      }
      list.push(def as McpToolDefinition);
      byModule.set(c.moduleId, list);
    }
    if (defs.length === 0) problems.push({ contributionId: c.contributionId, message: 'exports no tool' });
    const ids = c.ids;
    if (!ids) problems.push({ contributionId: c.contributionId, message: 'metadata.ids must list the tool names' });
    else if (contributionOk && [...ids].sort().join(',') !== [...names].sort().join(',')) {
      problems.push({ contributionId: c.contributionId, message: `metadata.ids (${ids.join(', ')}) differ from the exported tools (${names.join(', ')})` });
    }
  }

  const catalog = new Map<string, readonly McpToolDefinition[]>(
    [...byModule.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([m, tools]) => [m, [...tools].sort((x, y) => x.name.localeCompare(y.name))]),
  );
  return { ok: problems.length === 0, problems, catalog };
}

export function describeToolProblems(problems: readonly ToolRegistryProblem[]): string {
  return [`mcp_server:tool: ${problems.length} problem(s) refuse the boot:`,
    ...problems.map((p) => `  - ${p.contributionId}${p.tool ? ` ${p.tool}` : ''}: ${p.message}`)].join('\n');
}
