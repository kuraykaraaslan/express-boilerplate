import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '@kuraykaraaslan-labs/env';
import { registerMetricSource, type MetricSource } from './process-hooks';
import { PROBE_CLASS_RE, PROBE_RUN_ID_RE, type ProbeStamp } from './common.firewall-probe-run';

/**
 * The run-id trust rule (docs/phases/55-ai-firewall/03 §3.3, §3.4; D55-82, D55-84, D55-85): whether a request's probe-run mark is believed.
 *
 * A mark is three headers: the run id (`x-fw-probe-run`), the label class the request produces (`x-fw-probe-class`) and a PROOF that the
 * sender holds the runner's own credential (`x-fw-probe-key`: `p1.` + base64url HMAC-SHA256 of `nb.fw-probe/1\n<run>\n<class>` under the
 * credential's SHA-256, `probeProofOf`; D55-95). The credential itself never travels: a header that reaches a wrong host, a mistyped
 * target or a third party is good for that one run id and class only, never for another run or class. It is believed ONLY when
 *
 *   1. the install says it is a staging install (`INSTALL_ROLE=staging`; `demo` for benign traffic only) — one explicit setting, default
 *      `production`, never inferred from a hostname; on a production install the headers are ignored before the credential is even
 *      looked at;
 *   2. the request carries a proof made with the runner's own credential: a 256-bit secret whose SHA-256 the install holds (the MAC key:
 *      `AI_FIREWALL_PROBE_RUNNER_SHA256` for the probe runner, staging only, any class; `AI_FIREWALL_BENIGN_RUNNER_SHA256` for benign
 *      traffic, staging or demo, the class `benign` only), compared in constant time. The credential authorises NOTHING else: it is not a
 *      session, not an API key and opens no route (least privilege); the probes authenticate as the seeded test people in their normal
 *      headers;
 *   3. the run id and the class have their shapes.
 *
 * Everywhere else the headers are ignored and counted (`ai_firewall_probe_marks_total{result}`). Only the tenant API dispatcher asks,
 * once per request; what it accepts runs inside `runWithProbeRun` (common.firewall-probe-run.ts). Synchronous, never throws, no I/O.
 */
export type InstallRole = 'production' | 'staging' | 'demo';
export const INSTALL_ROLES: readonly InstallRole[] = ['production', 'staging', 'demo'];

export const PROBE_RUN_HEADER = 'x-fw-probe-run';
export const PROBE_CLASS_HEADER = 'x-fw-probe-class';
export const PROBE_KEY_HEADER = 'x-fw-probe-key';
/** On an accepted request's answer only (the runner's handshake reads it): the run id, so only a caller holding the credential learns it. */
export const PROBE_ACCEPTED_HEADER = 'x-fw-probe-accepted';

/** The class benign traffic declares. */
export const BENIGN_CLASS = 'benign';
/** Longest credential header looked at (a runner credential is 43 base64url characters); a longer one is refused unread. */
export const PROBE_KEY_MAX = 256;

export const PROBE_MARK_RESULTS = ['accepted', 'not_staging', 'no_credential', 'bad_credential', 'malformed', 'class_refused'] as const;
export type ProbeMarkResult = (typeof PROBE_MARK_RESULTS)[number];

export interface ProbeGateConfig {
  installRole: InstallRole;
  /** SHA-256 hex of the probe runner's credential, or null. */
  probeRunnerSha256: string | null;
  /** SHA-256 hex of the benign-traffic credential, or null. */
  benignRunnerSha256: string | null;
}

export type ProbeMarkDecision =
  | { result: 'accepted'; stamp: Omit<ProbeStamp, 'startedAt' | 'endedAt'> }
  | { result: Exclude<ProbeMarkResult, 'accepted'>; stamp: null };

/** An install role from a raw value: anything but `staging` or `demo` (unset, misspelt) is `production`. */
export function installRoleOf(raw: unknown): InstallRole {
  return raw === 'staging' || raw === 'demo' ? raw : 'production';
}

const HEX64 = /^[0-9a-f]{64}$/i;

/** Whether the credential's SHA-256 is `digest` (constant time; false for a missing or malformed digest). */
export function credentialMatches(credential: string, digest: string | null): boolean {
  if (!digest || !HEX64.test(digest)) return false;
  const seen = createHash('sha256').update(credential, 'utf8').digest();
  return timingSafeEqual(seen, Buffer.from(digest.toLowerCase(), 'hex'));
}

/** The credential's digest as the install keeps it (the seed prints it for the staging env). */
export const credentialDigest = (credential: string): string => createHash('sha256').update(credential, 'utf8').digest('hex');

/** The proof scheme's version prefix and the message's domain (D55-95). */
export const PROBE_PROOF_PREFIX = 'p1.';
const PROOF_DOMAIN = 'nb.fw-probe/1';

/**
 * The proof of a mark (pure): `p1.` + base64url(HMAC-SHA256(key = the credential's SHA-256 bytes, "nb.fw-probe/1\n<runId>\n<class>")).
 * The runner (`scripts/fw-probe/lib/credential.ts` `probeProof`, the same formula) and the benign-header tool make it; the install, which
 * holds only the digest, checks it. Throws for a digest that is not 64 hex characters.
 */
export function probeProofOf(digestHex: string, runId: string, labelClass: string): string {
  if (!HEX64.test(digestHex)) throw new Error('the digest is 64 hex characters');
  const mac = createHmac('sha256', Buffer.from(digestHex.toLowerCase(), 'hex')).update(`${PROOF_DOMAIN}\n${runId}\n${labelClass}`, 'utf8').digest('base64url');
  return `${PROBE_PROOF_PREFIX}${mac}`;
}

/** Whether `proof` is the proof of (runId, labelClass) under `digest` (constant time; false for a missing or malformed digest or proof). */
export function proofMatches(proof: string, runId: string, labelClass: string, digest: string | null): boolean {
  if (!digest || !HEX64.test(digest) || !proof.startsWith(PROBE_PROOF_PREFIX)) return false;
  const want = Buffer.from(probeProofOf(digest, runId, labelClass), 'utf8');
  const seen = Buffer.from(proof, 'utf8');
  return seen.length === want.length && timingSafeEqual(seen, want);
}

/**
 * The trust rule (pure). null: the request carries no probe header at all (the common case: nothing counted). Otherwise what became of
 * the mark; a stamp only when it was accepted.
 */
export function decideProbeMark(headers: { get(name: string): string | null }, config: ProbeGateConfig): ProbeMarkDecision | null {
  const runId = headers.get(PROBE_RUN_HEADER);
  const labelClass = headers.get(PROBE_CLASS_HEADER);
  const key = headers.get(PROBE_KEY_HEADER);
  if (runId === null && labelClass === null && key === null) return null;
  // 1. the install role first: on production nothing else is read
  if (config.installRole === 'production') return { result: 'not_staging', stamp: null };
  // 3. the shapes
  if (!runId || !PROBE_RUN_ID_RE.test(runId) || !labelClass || !PROBE_CLASS_RE.test(labelClass)) return { result: 'malformed', stamp: null };
  // 2. the proof of the credential (never the credential itself, D55-95: a raw credential is a bad one)
  if (!key) return { result: 'no_credential', stamp: null };
  if (key.length > PROBE_KEY_MAX) return { result: 'bad_credential', stamp: null };
  const source = labelClass === BENIGN_CLASS ? 'benign_traffic' : 'synthetic';
  if (proofMatches(key, runId, labelClass, config.probeRunnerSha256)) {
    // the probe runner's credential: staging only (never the demo, never production)
    if (config.installRole !== 'staging') return { result: 'not_staging', stamp: null };
    return { result: 'accepted', stamp: { runId, labelClass, source } };
  }
  if (proofMatches(key, runId, labelClass, config.benignRunnerSha256)) {
    // the benign-traffic credential (staging or demo): it may only say "benign"
    if (labelClass !== BENIGN_CLASS) return { result: 'class_refused', stamp: null };
    return { result: 'accepted', stamp: { runId, labelClass, source } };
  }
  return { result: 'bad_credential', stamp: null };
}

/** The install's role (env INSTALL_ROLE, default production). */
export function currentInstallRole(): InstallRole {
  return installRoleOf(env.INSTALL_ROLE);
}

/** The gate's configuration from the install's env, read per call (cheap; the env object is frozen at boot). */
export function probeGateConfig(): ProbeGateConfig {
  return {
    installRole: currentInstallRole(),
    probeRunnerSha256: env.AI_FIREWALL_PROBE_RUNNER_SHA256 ?? null,
    benignRunnerSha256: env.AI_FIREWALL_BENIGN_RUNNER_SHA256 ?? null,
  };
}

interface GateState {
  counts: Record<ProbeMarkResult, number>;
  registered: boolean;
}
const STATE_KEY = Symbol.for('kuraykaraaslan-labs.common.firewallProbeGate');
const holder = globalThis as unknown as Record<symbol, GateState | undefined>;
const freshCounts = (): Record<ProbeMarkResult, number> =>
  Object.fromEntries(PROBE_MARK_RESULTS.map((r) => [r, 0])) as Record<ProbeMarkResult, number>;
const state = (): GateState => (holder[STATE_KEY] ??= { counts: freshCounts(), registered: false });

/** This process's marks by what became of them. */
export function probeMarkCounts(): Record<ProbeMarkResult, number> {
  return { ...state().counts };
}

/** The gate's series, read at scrape time (a growing gauge, like the intake's counters). */
export function probeMarkMetricSources(): MetricSource[] {
  return [{
    name: 'ai_firewall_probe_marks_total',
    help: 'Requests that carried an AI firewall probe-run mark (phase 55 03 §3.3), by what became of it: accepted (a staging or demo install and the runner\'s own credential), or ignored: not_staging (a production install, or the probe credential off staging), no_credential, bad_credential, malformed (run id or class), class_refused (the benign credential declaring an attack).',
    labelNames: ['result'],
    read: async () => PROBE_MARK_RESULTS.map((result) => ({ labels: { result }, value: state().counts[result] })),
  }];
}

/**
 * The dispatcher's question: the request's accepted stamp, or null. Counts every request that carried a mark. Never throws: a failure
 * here is no mark (the request is served exactly as without one).
 */
export function probeStampOf(request: { headers: { get(name: string): string | null } }, config: () => ProbeGateConfig = probeGateConfig): ProbeMarkDecision | null {
  try {
    const decision = decideProbeMark(request.headers, config());
    if (!decision) return null;
    const s = state();
    if (!s.registered) {
      s.registered = true;
      for (const source of probeMarkMetricSources()) registerMetricSource(source);
    }
    s.counts[decision.result] += 1;
    return decision;
  } catch {
    return null;
  }
}

/** Test seam: forget the counts. */
export function resetProbeGate(): void {
  holder[STATE_KEY] = { counts: freshCounts(), registered: state().registered };
}
