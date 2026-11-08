import { z } from 'zod';

/**
 * Policy axes and their merge rules (docs/phases/02-fleet/04-security-model.md section 4.3).
 * effective = merge(central, override); every axis moves only in the tightening direction.
 *   intersect (allowlists), and (booleans), max (floors), min (ceilings).
 */
export type MergeRule = 'intersect' | 'and' | 'max' | 'min';

export const POLICY_AXES = {
  allowedCommandKinds: 'intersect',
  allowedModuleIds: 'intersect',
  allowedReleaseChannels: 'intersect',
  allowedStorageEndpoints: 'intersect',
  allowedTelemetryEndpoints: 'intersect',
  allowedEgressEndpoints: 'intersect',
  allowedMigrationTargets: 'intersect',
  allowedRedirectSuffixes: 'intersect',
  allowedBackupLocations: 'intersect',
  breakGlassAllowed: 'and',
  outboundMigrationsAllowed: 'and',
  selfServeSignupAllowed: 'and',
  localFailoverAllowed: 'and',
  minApprovals: 'max',
  auditLogRetentionDaysMin: 'max',
  deletionGraceDaysMin: 'max',
  backupRetentionDaysMin: 'max',
  mfaRequired: 'max',
  breakGlassMaxMinutes: 'min',
  deletionGraceDaysMax: 'min',
  logRetentionDaysMax: 'min',
  maxDedicatedDbs: 'min',
  capacityThreshold: 'min',
} as const satisfies Record<string, MergeRule>;
export type PolicyAxis = keyof typeof POLICY_AXES;

const list = z.array(z.string().min(1).max(256)).max(500);
const int = z.number().int().nonnegative().max(2 ** 31);

const shape: Record<PolicyAxis, z.ZodType> = {
  allowedCommandKinds: list, allowedModuleIds: list, allowedReleaseChannels: list, allowedStorageEndpoints: list,
  allowedTelemetryEndpoints: list, allowedEgressEndpoints: list, allowedMigrationTargets: list,
  allowedRedirectSuffixes: list, allowedBackupLocations: list,
  breakGlassAllowed: z.boolean(), outboundMigrationsAllowed: z.boolean(), selfServeSignupAllowed: z.boolean(), localFailoverAllowed: z.boolean(),
  minApprovals: int, auditLogRetentionDaysMin: int, deletionGraceDaysMin: int, backupRetentionDaysMin: int,
  mfaRequired: int, breakGlassMaxMinutes: int, deletionGraceDaysMax: int, logRetentionDaysMax: int,
  maxDedicatedDbs: int, capacityThreshold: int,
};

/** A policy document: any subset of axes; unknown axes are rejected. */
export const PolicySchema = z
  .object(Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, v.optional()])) as Record<PolicyAxis, z.ZodOptional<z.ZodType>>)
  .strict();
/** One axis value: a string allowlist, a boolean, or a number (per the axis's merge rule). */
export type PolicyValue = string[] | boolean | number;
export type Policy = Partial<Record<PolicyAxis, PolicyValue>>;

export class PolicyConflictError extends Error {
  constructor(public readonly axis: PolicyAxis) {
    super(`policy.conflict: empty intersection on ${axis}`);
  }
}

function mergeAxis(rule: MergeRule, axis: PolicyAxis, a: PolicyValue | undefined, b: PolicyValue | undefined): PolicyValue | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  switch (rule) {
    case 'intersect': {
      const set = new Set<string>(b as string[]);
      const out = [...new Set<string>(a as string[])].filter((x) => set.has(x));
      if (out.length === 0) throw new PolicyConflictError(axis);
      return out;
    }
    case 'and': return (a as boolean) && (b as boolean);
    case 'max': return Math.max(a as number, b as number);
    case 'min': return Math.min(a as number, b as number);
  }
}

/** Per-axis merge of two validated policies. Throws PolicyConflictError on an empty allowlist intersection. */
export function mergePolicy(central: Policy, override: Policy): Policy {
  const out: Policy = {};
  for (const axis of Object.keys(POLICY_AXES) as PolicyAxis[]) {
    const v = mergeAxis(POLICY_AXES[axis], axis, central[axis], override[axis]);
    if (v !== undefined) out[axis] = v;
  }
  return out;
}

/** Axes on which `next` is looser than `prev` (absent = unconstrained = loosest). Any hit makes policy.apply class 3. */
export function loosenedAxes(prev: Policy, next: Policy): PolicyAxis[] {
  const hits: PolicyAxis[] = [];
  for (const axis of Object.keys(POLICY_AXES) as PolicyAxis[]) {
    const p = prev[axis];
    const n = next[axis];
    if (p === undefined) continue; // nothing to loosen
    if (n === undefined) { hits.push(axis); continue; }
    switch (POLICY_AXES[axis]) {
      case 'intersect': if ((n as string[]).some((x) => !(p as string[]).includes(x))) hits.push(axis); break;
      case 'and': if (n && !p) hits.push(axis); break;
      case 'max': if ((n as number) < (p as number)) hits.push(axis); break;
      case 'min': if ((n as number) > (p as number)) hits.push(axis); break;
    }
  }
  return hits;
}
