/**
 * The tool registry: every `mcp_server:tool` contribution, loaded once per process in a SYSTEM context and checked
 * (docs/phases/57-mcp-server D57-4, D57-5). The catalogue is process-wide; whether a tenant may use a module's tools is the request's
 * question (module activation, the caller's permissions), answered in mcp_server.http.
 *
 * The boot guard `mcp-tools` (`common:boot_task`, phase `guard`) loads it afresh and refuses the boot on any problem. The verdict is
 * kept on `globalThis`: the instrumentation hook and the route bundles each load this file.
 */
import type { ExtensionPointLoaders } from '@kuraykaraaslan-labs/common/server/extension-registry';
import { ext, systemCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext';
import { mcpServerToolLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/mcp_server.tool';
import { isKeyGrantable, isReadOnlyPermission, permissionEntry } from '@kuraykaraaslan-labs/api_key/server/api_key.permissions';
import {
  describeToolProblems,
  validateToolRegistry,
  type LoadedToolContribution,
  type PermissionFacts,
  type ToolRegistryInput,
  type ToolRegistryVerdict,
} from './mcp_server.registry.validate';

/** The extension point this module declares (module.json `extensionPoints`). */
export const MCP_TOOL_POINT = 'mcp_server:tool';

const CTX = systemCtx('mcp_server registry: the process-wide catalogue of MCP tools');
const STATE_KEY = Symbol.for('kuraykaraaslan-labs.mcp_server.registry');
const holder = globalThis as unknown as Record<symbol, Promise<ToolRegistryVerdict> | undefined>;

const idsOf = (metadata: Record<string, unknown>): string[] | null =>
  Array.isArray(metadata.ids) && metadata.ids.every((v) => typeof v === 'string') ? (metadata.ids as string[]) : null;

/** The permission catalogue as the checks need it: owner module, key-grantable (phase 48), read-only. */
export function permissionFacts(permissionId: string): PermissionFacts | undefined {
  const entry = permissionEntry(permissionId);
  if (!entry) return undefined;
  return { moduleId: entry.moduleId, keyGrantable: isKeyGrantable(entry), readOnly: isReadOnlyPermission(permissionId) };
}

/** Every installed contribution, loaded or listed as failed. Never throws. */
async function loadContributions(loaders: ExtensionPointLoaders): Promise<Pick<ToolRegistryInput, 'loaded' | 'failed'>> {
  const loadedOut: LoadedToolContribution[] = [];
  const failed: ToolRegistryInput['failed'] = [];
  try {
    const order = (await ext.states(MCP_TOOL_POINT, CTX)).map((s) => s.contribution);
    const { loaded, failed: notLoaded } = await ext.loadAll<unknown>(MCP_TOOL_POINT, CTX, loaders);
    const implOf = new Map(loaded.map((l) => [l.contribution.id, l.impl]));
    const failureOf = new Map(notLoaded.map((f) => [f.contributionId, f.message]));
    for (const c of order) {
      if (implOf.has(c.id)) loadedOut.push({ contributionId: c.id, moduleId: c.moduleId, ids: idsOf(c.metadata ?? {}), impl: implOf.get(c.id) });
      else failed.push({ contributionId: c.id, message: failureOf.get(c.id) ?? 'not loaded by the host runtime (paused?)' });
    }
  } catch (error) {
    failed.push({ contributionId: `${MCP_TOOL_POINT} (all)`, message: error instanceof Error ? error.message : String(error) });
  }
  return { loaded: loadedOut, failed };
}

/** Loads and checks every contribution (no cache). */
export async function loadToolRegistry(): Promise<ToolRegistryVerdict> {
  const { loaded, failed } = await loadContributions(mcpServerToolLoaders);
  return validateToolRegistry({ loaded, failed, permissionOf: permissionFacts });
}

/** The process's verdict, loaded on first use and then kept. */
export function toolRegistry(): Promise<ToolRegistryVerdict> {
  holder[STATE_KEY] ??= loadToolRegistry().catch((error: unknown) => {
    holder[STATE_KEY] = undefined;
    throw error;
  });
  return holder[STATE_KEY]!;
}

/** The boot guard: refuses the boot on any problem, naming the contribution, the tool and the rule. */
export async function assertMcpToolRegistry(): Promise<string> {
  const verdict = await loadToolRegistry();
  holder[STATE_KEY] = Promise.resolve(verdict);
  if (!verdict.ok) throw new Error(describeToolProblems(verdict.problems));
  const tools = [...verdict.catalog.values()].reduce((n, list) => n + list.length, 0);
  return `mcp_server registry: ${tools} tools in ${verdict.catalog.size} servers`;
}

/** Test seam: forget the process's verdict. */
export function resetToolRegistry(): void {
  holder[STATE_KEY] = undefined;
}
