import { z } from 'zod';
import { ResultCodeSchema } from './g.schema';
import { isSemver } from './release.verify';

/** Telemetry classes (docs/phases/02-fleet/01-data-classification.md). Unclassified defaults to R, never G. */
export const TELEMETRY_CLASSES = ['G', 'R', 'X'] as const;
export const TelemetryClassSchema = z.enum(TELEMETRY_CLASSES);
export type TelemetryClass = z.infer<typeof TelemetryClassSchema>;
export const DEFAULT_TELEMETRY_CLASS: TelemetryClass = 'R';

const metricName = z.string().regex(/^[a-z][a-z0-9_]{0,95}$/);
const finite = z.number().finite();

/**
 * Heartbeat `metrics` block / G telemetry snapshot: bounded numbers keyed by allowlisted metric names, enum
 * statuses, hashes. No free strings; label keys such as tenantId/userId are not representable.
 */
export const GTelemetrySchema = z
  .object({
    metrics: z.record(metricName, finite).refine((m) => Object.keys(m).length <= 500, 'too many metrics'),
    status: ResultCodeSchema.optional(),
    effectivePolicyHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    /** Fingerprint (sha256 of the SPKI, hex) of the regional operator key that signed the policy override now in force; absent when none is. Hash class, never free text. */
    policyOverrideSigner: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    /** `managedStateHash` of the config keys / flags the fleet has set on this node, as the node holds them now (drift detection). */
    configHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    flagsHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    collectedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/),
  })
  .strict();
export type GTelemetry = z.infer<typeof GTelemetrySchema>;

const FORBIDDEN_LABELS = /(^|_)(tenant|tenantid|user|userid|email|phone|ip|name)(_|$)/i;
export function isForbiddenMetricName(name: string): boolean {
  return FORBIDDEN_LABELS.test(name);
}

/**
 * The metrics a node's APP may contribute to the heartbeat (`observability` `exportGlobalSafe`, over the app's loopback): a closed set of integer series with the
 * definitions of the node's recording rules. The agent accepts these names from the app and no others, so a confused or compromised app can drop a series but
 * never smuggle a label, a free string or a new series into class G. `observability` keeps the same list (a test pins that the two are equal).
 */
export const GLOBAL_APP_METRIC_NAMES = [
  'http_requests_per_minute', 'http_error_rate_permille', 'http_request_p50_ms', 'http_request_p95_ms', 'http_request_p99_ms', 'queue_failed_jobs',
] as const;

/**
 * The deployment license's health as G metrics (13-fleet-license.md step 3b.5, `fleet_license` `licenseMetrics`): integers, -1 = not applicable (a
 * perpetual license, an offline one without a lease). Nothing that names the license or its holder.
 */
export const LICENSE_METRIC_NAMES = [
  'license_state', 'license_valid', 'license_days_left', 'license_lease_days_left', 'license_updates_active', 'license_limited', 'license_managed',
] as const;

/** The deployment license's states (`fleet_license` `evaluateLicense`). `VALID` is the only one that grants anything. */
export const LICENSE_STATES = [
  'NONE', 'VALID', 'EXPIRED', 'NOT_YET_VALID', 'DEPLOYMENT_MISMATCH', 'LEASE_REQUIRED', 'LEASE_LAPSED', 'INVALID', 'MANAGEMENT_MISMATCH', 'HARDWARE_MISMATCH',
] as const;
export type LicenseState = (typeof LICENSE_STATES)[number];

/** Stable integer codes of the states, the value of the `license_state` metric: part of the telemetry contract, so never renumbered. */
export const LICENSE_STATE_CODE: Record<LicenseState, number> = {
  NONE: 0, VALID: 1, EXPIRED: 2, NOT_YET_VALID: 3, DEPLOYMENT_MISMATCH: 4, LEASE_REQUIRED: 5, LEASE_LAPSED: 6, INVALID: 7, MANAGEMENT_MISMATCH: 8, HARDWARE_MISMATCH: 9,
};

/** The license reading of one heartbeat, as the control plane keeps it per node: the closed set of license metrics, nothing else. */
export type LicenseReading = Partial<Record<(typeof LICENSE_METRIC_NAMES)[number], number>>;

/** The license metrics of a heartbeat's `metrics` (integers from -1), or null when it carries none: a node without a license module says nothing. */
export function licenseReadingOf(metrics: Record<string, unknown> | undefined): LicenseReading | null {
  if (!metrics) return null;
  const out: LicenseReading = {};
  for (const name of LICENSE_METRIC_NAMES) { const v = metrics[name]; if (typeof v === 'number' && Number.isSafeInteger(v) && v >= -1) out[name] = v; }
  return Object.keys(out).length ? out : null;
}

/** The state a `license_state` code names; null for a code this version does not know (a newer node). */
export function licenseStateOf(code: number | undefined): LicenseState | null {
  return (Object.entries(LICENSE_STATE_CODE).find(([, c]) => c === code)?.[0] as LicenseState | undefined) ?? null;
}

/**
 * What the node app may hand its agent as metrics: the closed sets above, safe integers only, at least 0 for the HTTP metrics and at least -1 for the
 * license ones. Applied on both sides of the loopback. (`queue_failed_jobs` is a count, not an HTTP metric, but it obeys the same floor of 0.)
 */
export function appMetricsFrom(raw: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of GLOBAL_APP_METRIC_NAMES) { const v = raw[name]; if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) out[name] = v; }
  for (const name of LICENSE_METRIC_NAMES) { const v = raw[name]; if (typeof v === 'number' && Number.isSafeInteger(v) && v >= -1) out[name] = v; }
  return out;
}

/**
 * The node's regional release pins as its heartbeat reports them (decision F21, X4-5): the `approvedReleases` of the admission block the host helper
 * enforces, which the control plane MIRRORS and never owns. G class: release versions (semver, the same identifiers `checkReleaseAdmission` compares),
 * at most `MAX_REPORTED_RELEASE_PINS` (the helper's own config cap), no duplicates. On the wire `null` says "this node does not pin" and an absent
 * field says nothing (an agent that predates it, or no helper to ask), so the two are never confused.
 */
export const MAX_REPORTED_RELEASE_PINS = 256;
export const ReportedReleasePinsSchema = z
  .array(z.string().max(64).refine(isSemver, 'not a semantic version'))
  .max(MAX_REPORTED_RELEASE_PINS)
  .refine((v) => new Set(v).size === v.length, 'duplicate release pin');
export type ReportedReleasePins = z.infer<typeof ReportedReleasePinsSchema>;

/**
 * Cuts a pin list from any source down to what `ReportedReleasePinsSchema` admits: `null` stays "does not pin", an array keeps its semver entries
 * (deduplicated, sorted, capped), anything else is `undefined` (say nothing). Dropping a non-semver entry never changes what the node admits: a release
 * version is always semver, so such a pin can never match one. A list over the cap is not cut (the control plane would then warn about releases the
 * node does admit): it is not reported at all.
 */
export function reportedReleasePinsOf(input: unknown): ReportedReleasePins | null | undefined {
  if (input === null) return null;
  if (!Array.isArray(input)) return undefined;
  const kept = [...new Set(input.filter((v): v is string => typeof v === 'string' && v.length <= 64 && isSemver(v)))].sort();
  return kept.length <= MAX_REPORTED_RELEASE_PINS ? kept : undefined;
}
