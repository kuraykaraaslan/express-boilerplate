// Shared types for the plugin-host isolate runtime.
import type { Capability, Json } from '../../sdk/types';
import type { SandboxViolation } from '../rpc/sandbox-violations';

export interface CallCtx {
  tenantId: string;
  /**
   * Phase 53.4: the tenant whose plugin secrets and plugin config (`plugin_secret:` / `plugin:` keys) the call reads, when it
   * is not `tenantId`: the root tenant's install serving a tenant at the `platform` setting level. Absent = `tenantId`.
   */
  configTenantId?: string;
  pluginId: string;
  capabilities: Capability[];
  /** Carried through to the broker (it needs these; the isolate never sees them). */
  httpAllowlist?: string[];
  limits?: { httpTimeoutMs: number; httpMaxBytes: number };
  /** Plugin setting keys the plugin may not write (its egress endpoint settings); see SandboxConfig. */
  protectedSettingKeys?: string[];
  /**
   * Phase 55 00 §0.3: the bounds this call hit, collected host-side while it runs (a refused host call does not end the run, so it is noted here,
   * never reported from the plugin's side). The plugin-host returns them with the answer; never sent to the broker.
   */
  violations?: SandboxViolation[];
}

/** A run stopped at one of the sandbox's own bounds (the wall clock, the result cap). */
export class SandboxViolationError extends Error {
  constructor(readonly violation: SandboxViolation, message: string) {
    super(message);
    this.name = 'SandboxViolationError';
  }
}

/**
 * Which bound, if any, an error of a run is: our own `SandboxViolationError`, else isolated-vm's messages ("Script execution timed out.",
 * "Isolate was disposed during execution due to memory limit"). Anything else (a plugin's own throw) is not a violation: null.
 */
export function sandboxViolationOf(error: unknown): SandboxViolation | null {
  if (error instanceof SandboxViolationError) return error.violation;
  const message = String((error as { message?: unknown } | null)?.message ?? '');
  if (/timed?[ -]?out/i.test(message)) return 'timeout';
  if (/memory limit/i.test(message)) return 'memory_limit';
  if (/result too large/i.test(message)) return 'result_too_large';
  return null;
}

/** Note a bound a call hit (at most once per kind). */
export function noteViolation(ctx: Pick<CallCtx, 'violations'> | null | undefined, violation: SandboxViolation): void {
  if (!ctx?.violations || ctx.violations.includes(violation)) return;
  ctx.violations.push(violation);
}

/** Resolves a capability call host-side (validates + runs the scoped operation). */
export type HostDispatch = (
  ctx: CallCtx,
  capability: string,
  method: string,
  args: Json[],
) => Promise<Json>;

export interface SandboxLimits {
  memoryMb: number;
  timeoutMs: number;
}

export const DEFAULT_LIMITS: SandboxLimits = { memoryMb: 128, timeoutMs: 5000 };
