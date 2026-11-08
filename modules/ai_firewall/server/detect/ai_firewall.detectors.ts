import type { ActorKind } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';
import type { FeatureVector } from '../features/ai_firewall.feature-vector';
import type { DetectionEvidence, DetectorId } from './ai_firewall.risk';

/**
 * The detectors of docs/phases/55-ai-firewall/02 §2.3, rules first: each a PURE function over an actor's feature vectors (behaviour.v1,
 * attack.v1, rules.v1; `ai_firewall.feature-vector.ts`), no I/O, no clock, no raw id. A detector is data plus a gate:
 *
 *   - variants: per actor kind, a gate (`when`, the pattern's necessary condition) and weighted terms;
 *   - a term ramps one feature from `lo` (nothing) to `hi` (fully there), linearly; `hi < lo` ramps downwards (fewer is worse);
 *     a missing feature (NaN) is no evidence (0), never a guess;
 *   - strength = Σ weight × ramp over the variant's terms (the weights of a variant add up to 1, test), and the detection holds when the
 *     gate passes and the strength reaches MIN_STRENGTH; its evidence is each term's share of the strength.
 *
 * The rule scorer (`ai_firewall.rule-scorer.ts`) turns a detection's strength into risk points (× the detector's weight) and spreads
 * them over the evidence features, so the explanation names the features that made the detection.
 *
 * What a detector cannot see yet is listed in the module README (2.3): form fill speed, near-identical e-mails and disposable domains
 * (2.6), invitations (no kind registered), impersonation length (the end row's duration is an attribute, not a feature), telemetry
 * floods (no device producer counts telemetry into the store yet).
 */

/** A feature's value by name across the actor's vectors; NaN when no vector carries it or its value is missing. */
export type FeatureLookup = (name: string) => number;

/** The lookup over vectors (the first vector that carries a name answers: the shared `lane` / `actor_kind` are the same in both). */
export function lookupOf(vectors: readonly Pick<FeatureVector, 'names' | 'values'>[]): FeatureLookup {
  const index = new Map<string, number>();
  for (const v of vectors) v.names.forEach((name, i) => { if (!index.has(name)) index.set(name, v.values[i] ?? NaN); });
  return (name) => index.get(name) ?? NaN;
}

/** A lookup from a plain record (tests, the dataset export's rows). */
export const lookupFrom = (values: Readonly<Record<string, number>>): FeatureLookup => (name) => (name in values ? values[name]! : NaN);

/** 0 below `lo`, 1 at `hi`, linear between; with `hi < lo` the other way round. NaN (missing) is 0. */
export function ramp(x: number, lo: number, hi: number): number {
  if (!Number.isFinite(x)) return 0;
  const t = hi >= lo ? (x - lo) / (hi - lo) : (lo - x) / (lo - hi);
  return t <= 0 ? 0 : t >= 1 ? 1 : t;
}

/** A feature's value for a gate: missing counts as 0. */
const n = (f: FeatureLookup, name: string): number => {
  const x = f(name);
  return Number.isFinite(x) ? x : 0;
};

export interface DetectorTerm {
  feature: string;
  lo: number;
  hi: number;
  weight: number;
}

export interface DetectorVariant {
  actorKinds: readonly ActorKind[];
  /** The pattern's necessary condition (counts, not shares, so a single stray event never opens it). */
  when: (f: FeatureLookup) => boolean;
  terms: readonly DetectorTerm[];
}

export interface DetectorDef {
  id: DetectorId;
  /** The most this detector adds to the noisy-OR of the score (a probability-like 0..1; points = 100 × weight × strength alone). */
  weight: number;
  /** FWA-6: device-lane findings are alerts only. */
  alertsOnly?: boolean;
  variants: readonly DetectorVariant[];
}

export interface DetectorHit {
  detector: DetectorId;
  strength: number;
  weight: number;
  evidence: DetectionEvidence[];
  alertsOnly: boolean;
}

/** Below this strength a passed gate is not a detection (one weak term alone). */
export const MIN_STRENGTH = 0.2;

const term = (feature: string, lo: number, hi: number, weight: number): DetectorTerm => ({ feature, lo, hi, weight });
const PERSON: readonly ActorKind[] = ['user', 'session'];
const PERSON_AND_KEY: readonly ActorKind[] = ['user', 'session', 'apiKey'];

export const DETECTORS: readonly DetectorDef[] = [
  {
    // Many accounts tried from one address, mostly failing, sometimes getting in.
    id: 'credential_stuffing',
    weight: 0.9,
    variants: [{
      actorKinds: ['ip'],
      when: (f) => Math.max(n(f, 'login_failures_1h'), n(f, 'auth_failures_1h')) >= 5 && n(f, 'distinct_accounts_1h') >= 3,
      terms: [
        term('distinct_accounts_1h', 3, 20, 0.35),
        term('login_failures_1h', 5, 50, 0.25),
        term('auth_failure_ratio_5m', 0.5, 0.95, 0.15),
        term('distinct_accounts_5m', 2, 10, 0.1),
        term('logins_1h', 0, 3, 0.15),
      ],
    }],
  },
  {
    // Few tries per account over very many accounts, slowly (under any per-account lockout).
    id: 'password_spray',
    weight: 0.85,
    variants: [{
      actorKinds: ['ip'],
      when: (f) => {
        const accounts = n(f, 'distinct_accounts_24h');
        const failures = n(f, 'login_failures_24h');
        return accounts >= 10 && failures >= 10 && failures <= 3 * accounts;
      },
      terms: [
        term('distinct_accounts_24h', 10, 100, 0.5),
        term('login_failures_24h', 10, 200, 0.3),
        term('logins_1h', 0, 3, 0.2),
      ],
    }],
  },
  {
    // 403 / 404 runs over sequential or scattered subject ids, permission.denied bursts.
    id: 'enumeration',
    weight: 0.8,
    variants: [{
      actorKinds: ['user', 'session', 'apiKey', 'ip', 'anon'],
      when: (f) => n(f, 'requests_5m') >= 20 && (
        n(f, 'status_404_ratio_5m') + n(f, 'status_403_ratio_5m') >= 0.3
        || n(f, 'sequential_id_steps_5m') >= 10
        || n(f, 'permission_denied_1h') >= 10),
      terms: [
        term('sequential_id_steps_5m', 5, 50, 0.3),
        term('status_404_ratio_5m', 0.2, 0.7, 0.2),
        term('status_403_ratio_5m', 0.1, 0.5, 0.15),
        term('distinct_subjects_5m', 20, 200, 0.15),
        term('permission_denied_1h', 5, 50, 0.1),
        term('new_endpoints_1h', 5, 40, 0.1),
      ],
    }],
  },
  {
    // A refresh token used again after its rotation, a country change inside a session (impossible travel between requests), the
    // device, address or fingerprint switching mid-session.
    id: 'session_hijack',
    weight: 0.85,
    variants: [{
      actorKinds: PERSON,
      when: (f) => n(f, 'refresh_reuses_24h') >= 1 || n(f, 'geo_anomalies_24h') >= 1 || n(f, 'fingerprint_switches_24h') >= 2
        || (n(f, 'new_devices_today') >= 1 && n(f, 'new_countries_today') >= 1),
      terms: [
        term('refresh_reuses_24h', 0, 1, 0.35),
        term('geo_anomalies_24h', 0, 1, 0.2),
        term('fingerprint_switches_24h', 1, 4, 0.15),
        term('new_countries_today', 0, 2, 0.1),
        term('new_devices_today', 0, 2, 0.1),
        term('distinct_addresses_24h_vs_usual', 1, 3, 0.1),
      ],
    }],
  },
  {
    // Far more exported, listed or touched than this actor usually does (its own baseline, or its role's prior), or very deep paging.
    id: 'data_exfiltration',
    weight: 0.75,
    variants: [{
      actorKinds: PERSON_AND_KEY,
      when: (f) => n(f, 'deep_pages_5m') >= 10 || (
        (n(f, 'export_bytes_24h_vs_usual') >= 2 || n(f, 'volume_export_1h_vs_usual') >= 2
          || n(f, 'distinct_subjects_24h_vs_usual') >= 2 || n(f, 'volume_list_1h_vs_usual') >= 2)
        && (n(f, 'export_requests_24h') >= 1 || n(f, 'deep_pages_5m') >= 3)),
      terms: [
        term('export_bytes_24h_vs_usual', 1, 5, 0.3),
        term('volume_export_1h_vs_usual', 1, 4, 0.15),
        term('distinct_subjects_24h_vs_usual', 1, 4, 0.2),
        term('deep_pages_5m', 3, 30, 0.15),
        term('paging_depth_mean_5m', 5, 50, 0.1),
        term('volume_list_1h_vs_usual', 1, 4, 0.1),
      ],
    }],
  },
  {
    // Platform-admin grants, bulk role / policy / membership changes, security downgrades, admin work or impersonation off hours.
    id: 'admin_misuse',
    weight: 0.7,
    variants: [{
      actorKinds: PERSON,
      when: (f) => {
        const offHours = n(f, 'unusual_hour') >= 0.8;
        return n(f, 'platform_admin_grants_24h') >= 1 || n(f, 'role_changes_1h') >= 5 || n(f, 'policy_changes_1h') >= 5
          || n(f, 'member_removals_1h') >= 5 || n(f, 'security_downgrades_24h') >= 3 || n(f, 'impersonations_24h') >= 4
          || (offHours && (n(f, 'admin_actions_24h_vs_usual') >= 2 || n(f, 'impersonations_24h') >= 1));
      },
      terms: [
        term('platform_admin_grants_24h', 0, 1, 0.2),
        term('role_changes_1h', 3, 20, 0.15),
        term('policy_changes_1h', 3, 20, 0.1),
        term('member_removals_1h', 3, 20, 0.1),
        term('impersonations_24h', 0, 4, 0.1),
        term('admin_actions_24h_vs_usual', 1, 4, 0.15),
        term('unusual_hour', 0.5, 1, 0.1),
        term('security_downgrades_24h', 1, 5, 0.1),
      ],
    }],
  },
  {
    // A key probing scopes it does not hold, used from a new network or new places, woken after dormancy; an address guessing keys.
    id: 'api_key_abuse',
    weight: 0.75,
    variants: [
      {
        actorKinds: ['apiKey'],
        when: (f) => (n(f, 'requests_5m') >= 10 && n(f, 'status_403_ratio_5m') >= 0.2) || n(f, 'permission_denied_1h') >= 10
          || n(f, 'new_asns_today') >= 1 || n(f, 'distinct_addresses_24h_vs_usual') >= 2 || n(f, 'key_anomalies_24h') >= 1
          || (n(f, 'volume_total_24h_vs_usual') >= 3 && n(f, 'baseline_days') >= 7),
        terms: [
          term('status_403_ratio_5m', 0.1, 0.5, 0.25),
          term('permission_denied_1h', 5, 50, 0.15),
          term('new_asns_today', 0, 2, 0.15),
          term('distinct_addresses_24h_vs_usual', 1, 4, 0.15),
          term('volume_total_24h_vs_usual', 2, 6, 0.15),
          term('key_anomalies_24h', 0, 2, 0.15),
        ],
      },
      {
        actorKinds: ['ip', 'anon'],
        when: (f) => n(f, 'key_verify_failures_1h') >= 5,
        terms: [term('key_verify_failures_1h', 5, 50, 0.7), term('status_401_ratio_5m', 0.3, 0.9, 0.3)],
      },
    ],
  },
  {
    // Scripted traffic on public pages: clockwork timing, no asset loads, odd headers, script user agents, high rates.
    //
    // D55-44: "no asset loads" is weak evidence on its own: a returning browser serves `/_next/static` from its cache (immutable), so
    // its asset share is about 0 even on real page loads. So missing assets never open the gate alone (they are evidence once timing,
    // headers or the user agent opened it, and loading assets still clears clockwork timing). Page loads speak for "public pages" only
    // for an address no account signed in from in the last hour (`requests_5m` counts API answers too, and a signed-in user's
    // dashboard polls its API on a fixed beat); an address with signed-in people still opens the gate on its public API share.
    // `rc:page` counts document navigations only (request-meta).
    id: 'public_bot',
    weight: 0.6,
    variants: [{
      actorKinds: ['ip', 'anon'],
      when: (f) => {
        const assets = f('asset_ratio_5m');
        const loadsAssets = Number.isFinite(assets) && assets > 0.1;
        const signedIn = n(f, 'distinct_accounts_1h') >= 1;
        const pages = n(f, 'route_public_ratio_5m') >= 0.3 || (Number.isFinite(assets) && !signedIn);
        const scripted = (n(f, 'timing_regular_ratio_5m') >= 0.3 && !loadsAssets)
          || n(f, 'header_anomaly_ratio_5m') >= 0.5 || n(f, 'ua_script_ratio_5m') + n(f, 'ua_empty_ratio_5m') >= 0.5;
        return n(f, 'requests_5m') >= 30 && pages && scripted;
      },
      terms: [
        term('timing_regular_ratio_5m', 0.2, 0.8, 0.25),
        term('asset_ratio_5m', 0.3, 0, 0.2),
        term('header_anomaly_ratio_5m', 0.2, 0.8, 0.15),
        term('ua_script_ratio_5m', 0.2, 0.8, 0.1),
        term('ua_empty_ratio_5m', 0.1, 0.5, 0.1),
        term('ua_bot_ratio_5m', 0.2, 0.8, 0.05),
        term('requests_1m', 30, 300, 0.15),
      ],
    }],
  },
  {
    // Many sign-ups or new workspaces from one address; a brand-new account at once creating keys, exporting or administering.
    id: 'signup_abuse',
    weight: 0.6,
    variants: [
      {
        actorKinds: ['ip'],
        when: (f) => n(f, 'signups_1h') >= 3 || n(f, 'signups_24h') >= 10 || n(f, 'workspaces_created_24h') >= 3,
        terms: [term('signups_1h', 2, 20, 0.45), term('signups_24h', 5, 50, 0.35), term('workspaces_created_24h', 1, 10, 0.2)],
      },
      {
        actorKinds: ['user'],
        when: (f) => n(f, 'signups_24h') >= 1 && (n(f, 'api_keys_created_1h') >= 1 || n(f, 'export_requests_24h') >= 1 || n(f, 'route_admin_ratio_5m') >= 0.3),
        terms: [
          term('signups_24h', 0, 1, 0.15),
          term('api_keys_created_1h', 0, 3, 0.4),
          term('export_requests_24h', 0, 5, 0.3),
          term('route_admin_ratio_5m', 0.1, 0.5, 0.15),
        ],
      },
    ],
  },
  {
    // The device lane (an IoT contribution read from the iot signals already registered, no IoT module imported): one device
    // credential from several places, device event floods, an address hammering the gateway's credential checks. Alerts only (FWA-6).
    id: 'device_lane',
    weight: 0.7,
    alertsOnly: true,
    variants: [
      {
        actorKinds: ['device', 'node'],
        when: (f) => n(f, 'device_addresses_1h') >= 2 || n(f, 'device_events_1m') >= 600,
        terms: [term('device_addresses_1h', 1, 4, 0.6), term('device_events_1m', 300, 3000, 0.4)],
      },
      {
        actorKinds: ['ip', 'anon'],
        when: (f) => n(f, 'device_auth_blocks_1h') >= 1 || n(f, 'device_recoveries_24h') >= 3,
        terms: [term('device_auth_blocks_1h', 0, 5, 0.6), term('device_recoveries_24h', 1, 10, 0.25), term('denied_signals_5m', 3, 30, 0.15)],
      },
    ],
  },
];

/** One detector over one actor: a hit, or null (gate closed, too weak, or not about this actor kind). Never throws. */
export function runDetector(d: DetectorDef, actorKind: ActorKind, f: FeatureLookup): DetectorHit | null {
  try {
    const variant = d.variants.find((v) => v.actorKinds.includes(actorKind));
    if (!variant || !variant.when(f)) return null;
    const parts = variant.terms.map((t) => ({ feature: t.feature, part: t.weight * ramp(f(t.feature), t.lo, t.hi) }));
    const strength = Math.min(1, parts.reduce((s, p) => s + p.part, 0));
    if (!(strength >= MIN_STRENGTH)) return null;
    const total = parts.reduce((s, p) => s + p.part, 0);
    const evidence = parts.filter((p) => p.part > 0).map((p) => ({ feature: p.feature, share: p.part / total }));
    return { detector: d.id, strength, weight: d.weight, evidence, alertsOnly: d.alertsOnly === true };
  } catch {
    return null;
  }
}

/** Every detector over one actor, in DETECTORS order. */
export function runDetectors(actorKind: ActorKind, f: FeatureLookup, detectors: readonly DetectorDef[] = DETECTORS): DetectorHit[] {
  const out: DetectorHit[] = [];
  for (const d of detectors) {
    const hit = runDetector(d, actorKind, f);
    if (hit) out.push(hit);
  }
  return out;
}
