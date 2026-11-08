/**
 * Phase 55 00 §0.3 (P-3): a bound of the sandbox a run hit (`host/sandbox.ts` SANDBOX_LIMITS and the isolate's own limits). The plugin-host
 * names them in its answer (`RunResult.violations`); the web tier, which has the audit log, writes `plugin.sandbox_violation` (host-client.ts).
 * Its own file, with no import, so both tiers (and their tests' module mocks) read the one list.
 *  - `timeout`: the wall clock or isolated-vm's synchronous timeout stopped the run;
 *  - `memory_limit`: the isolate went over its memory limit and was disposed;
 *  - `result_too_large`: what the run returned was over the result cap;
 *  - `host_payload_too_large`, `host_calls_in_flight`: a host call the plugin made was refused (the run itself may still have answered).
 */
export const SANDBOX_VIOLATIONS = ['timeout', 'memory_limit', 'result_too_large', 'host_payload_too_large', 'host_calls_in_flight'] as const;
export type SandboxViolation = (typeof SANDBOX_VIOLATIONS)[number];

/** Whether a value the plugin-host sent is one of the names above. */
export function isSandboxViolation(v: unknown): v is SandboxViolation {
  return typeof v === 'string' && (SANDBOX_VIOLATIONS as readonly string[]).includes(v);
}
