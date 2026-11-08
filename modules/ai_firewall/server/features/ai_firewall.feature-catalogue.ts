import { createHash } from 'node:crypto';
import type { ActorKind } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';
import type { DistinctDim, RouteClass, WindowId } from './ai_firewall.feature-windows';

/**
 * The two versioned feature catalogues (docs/phases/55-ai-firewall/02 §2.1, 04 §4.4). A feature is defined ONCE, here, as data: its
 * name, the actor kinds it applies to, its window, its type, the model that owns it and the source it is computed from (a small closed
 * set of operations over the feature store, evaluated by `ai_firewall.feature-vector.ts`). Nothing else defines a feature, so the rule
 * scorer (2.2), the dataset export (03), the trainer and the request cascade (04) read the same vector.
 *
 *   behaviour.v1  read by the LightGBM model: how far an actor is from ITS OWN baseline (or its role's prior while it has none):
 *                 volume per route class against the EWMA, the unusual hour, new countries / ASNs / devices, subjects, addresses,
 *                 exports and admin actions against usual, session fingerprint switches, account age, MFA, baseline age.
 *   attack.v1     read by the XGBoost model: endpoint and HTTP metadata and attack indicators of the actor's recent traffic, and NO
 *                 baseline: status mix, route sensitivity mix, sequential ids, path and parameter shape, indicator tokens, user agent
 *                 family, header anomalies, timing regularity, asset loads, sign-in outcomes, distinct accounts per address, endpoints,
 *                 paging, refusals.
 *
 * The two are disjoint except the shared list (`lane`, `actor_kind`, 04.4); `ai_firewall.feature-catalogue.test.ts` fails when they
 * share another name or when attack.v1 reads a baseline. Each catalogue's content hash is pinned in CATALOGUE_HISTORY: changing any
 * feature (a name, a window, a source, the order) changes the hash, and the test then demands a version bump (a new history entry),
 * because a model trained on one vector must never be fed another (a model's meta file names the catalogue version and hash, 04.1).
 * The order of a catalogue is the model's feature order.
 */

/** `rules`: a feature only the rule scorer and the detectors read (`ai_firewall.rule-catalogue.ts`), never a model. */
export type FeatureModel = 'behaviour' | 'attack' | 'shared' | 'rules';
export type FeatureType = 'class' | 'count' | 'ratio' | 'distinct' | 'deviation' | 'share' | 'flag' | 'number';
/** A window of the store, `day` for the actor's UTC day profile, `none` for a fact of the request or the account. */
export type FeatureWindow = WindowId | 'day' | 'none';

/** What a deviation compares with: a daily EWMA of the actor's baseline (or its role prior). */
export type BaselineRef =
  | { kind: 'volume'; routeClass: RouteClass }
  | { kind: 'volumeTotal' | 'exportBytes' | 'subjects' | 'adminActions' | 'addresses' };

export type FeatureSource =
  /** A fact the caller supplies: the request's lane and the actor's kind (as their index in `codes`), the account's age, MFA, the baseline's age. */
  | { op: 'context'; key: 'lane' | 'actorKind'; codes: readonly string[] }
  | { op: 'context'; key: 'accountAgeDays' | 'mfaEnrolled' | 'baselineDays' }
  /** The sum of counter fields over a window. */
  | { op: 'count'; window: WindowId; fields: readonly string[] }
  /** sum(num) / sum(den) × scale over a window; missing (NaN) when the denominator is 0. */
  | { op: 'ratio'; window: WindowId; num: readonly string[]; den: readonly string[]; scale?: number }
  /** A distinct count (HyperLogLog) over a window. */
  | { op: 'distinct'; window: WindowId; dim: DistinctDim }
  /** How many counter fields with the prefix are above zero over a window (distinct families). */
  | { op: 'nonzero'; window: WindowId; prefix: string }
  /** log2((current + 1) / (usual + 1)): current = a count or a distinct count over the window; usual = the daily EWMA scaled to the window. */
  | { op: 'vsBaseline'; window: WindowId; fields?: readonly string[]; dim?: DistinctDim; baseline: BaselineRef }
  /** 1 − min(1, 24 × the baseline's share of activity in the current UTC hour): 0 for a usual hour, 1 for one never used. */
  | { op: 'unusualHour' }
  /** How many of today's countries / ASNs / devices the actor's own baseline does not know. */
  | { op: 'newValues'; of: 'countries' | 'asns' | 'devices' }
  /**
   * Σ over the window's `k:<kind>` counters of the kind's registered `defaultWeight` (`ai_firewall:signal`) × its count: the weighted
   * signal mass of the actor (rules.v1 only; the weights are the registry's, so no model reads it). Missing without the weights.
   */
  | { op: 'signalWeight'; window: WindowId };

export interface FeatureDef {
  name: string;
  model: FeatureModel;
  actorKinds: readonly ActorKind[];
  window: FeatureWindow;
  type: FeatureType;
  source: FeatureSource;
}

export interface FeatureCatalogue {
  id: 'behaviour' | 'attack';
  version: number;
  /** `<id>.v<version>`, the name a model's meta file records. */
  name: string;
  /** The library the model of this catalogue is trained with (FWD-6). */
  library: 'lightgbm' | 'xgboost';
  features: readonly FeatureDef[];
}

const ALL_ACTORS: readonly ActorKind[] = ['user', 'session', 'ip', 'apiKey', 'device', 'node', 'anon'];
const PERSON_AND_KEY: readonly ActorKind[] = ['user', 'session', 'apiKey'];
const PERSON: readonly ActorKind[] = ['user', 'session'];
const ADDRESS: readonly ActorKind[] = ['ip'];

/** The lanes and actor kinds as the context features encode them (the index); part of the hash, so a reordering bumps the version. */
export const LANE_CODES = [
  'human-web', 'human-native', 'public-anon', 'machine-apikey', 'machine-agent', 'device-iot', 'internal-cron', 'provider-webhook', 'unknown',
] as const;
export const ACTOR_KIND_CODES: readonly string[] = ALL_ACTORS;

function windowOf(source: FeatureSource): FeatureWindow {
  if ('window' in source) return source.window;
  return source.op === 'newValues' ? 'day' : 'none';
}
const def = (name: string, model: FeatureModel, actorKinds: readonly ActorKind[], type: FeatureType, source: FeatureSource): FeatureDef =>
  ({ name, model, actorKinds, window: windowOf(source), type, source });

/** The shared list (04.4): the only names both catalogues carry. */
export const SHARED_FEATURES: readonly FeatureDef[] = [
  def('lane', 'shared', ALL_ACTORS, 'class', { op: 'context', key: 'lane', codes: LANE_CODES }),
  def('actor_kind', 'shared', ALL_ACTORS, 'class', { op: 'context', key: 'actorKind', codes: ACTOR_KIND_CODES }),
];

const b = (name: string, actorKinds: readonly ActorKind[], type: FeatureType, source: FeatureSource) => def(name, 'behaviour', actorKinds, type, source);
const volume = (routeClass: RouteClass) =>
  b(`volume_${routeClass}_1h_vs_usual`, PERSON_AND_KEY, 'deviation', { op: 'vsBaseline', window: '1h', fields: [`rc:${routeClass}`], baseline: { kind: 'volume', routeClass } });

const BEHAVIOUR_OWN: readonly FeatureDef[] = [
  volume('read'),
  volume('list'),
  volume('write'),
  volume('admin'),
  volume('export'),
  volume('auth'),
  b('volume_total_24h_vs_usual', PERSON_AND_KEY, 'deviation', { op: 'vsBaseline', window: '24h', fields: ['rq'], baseline: { kind: 'volumeTotal' } }),
  b('unusual_hour', PERSON_AND_KEY, 'share', { op: 'unusualHour' }),
  b('new_countries_today', PERSON_AND_KEY, 'count', { op: 'newValues', of: 'countries' }),
  b('new_asns_today', PERSON_AND_KEY, 'count', { op: 'newValues', of: 'asns' }),
  b('new_devices_today', PERSON_AND_KEY, 'count', { op: 'newValues', of: 'devices' }),
  b('distinct_subjects_24h_vs_usual', PERSON_AND_KEY, 'deviation', { op: 'vsBaseline', window: '24h', dim: 'subj', baseline: { kind: 'subjects' } }),
  b('distinct_addresses_24h_vs_usual', PERSON_AND_KEY, 'deviation', { op: 'vsBaseline', window: '24h', dim: 'addr', baseline: { kind: 'addresses' } }),
  b('export_bytes_24h_vs_usual', PERSON_AND_KEY, 'deviation', { op: 'vsBaseline', window: '24h', fields: ['xb'], baseline: { kind: 'exportBytes' } }),
  b('admin_actions_24h_vs_usual', PERSON_AND_KEY, 'deviation', { op: 'vsBaseline', window: '24h', fields: ['adm'], baseline: { kind: 'adminActions' } }),
  b('fingerprint_switches_24h', PERSON, 'count', { op: 'count', window: '24h', fields: ['k:auth.login_anomaly', 'k:tenant.session.geo_anomaly'] }),
  b('account_age_days', PERSON, 'number', { op: 'context', key: 'accountAgeDays' }),
  b('mfa_enrolled', PERSON, 'flag', { op: 'context', key: 'mfaEnrolled' }),
  b('baseline_days', PERSON_AND_KEY, 'number', { op: 'context', key: 'baselineDays' }),
];

const a = (name: string, actorKinds: readonly ActorKind[], type: FeatureType, source: FeatureSource) => def(name, 'attack', actorKinds, type, source);
const perRequest = (name: string, num: readonly string[], scale?: number) =>
  a(name, ALL_ACTORS, 'ratio', { op: 'ratio', window: '5m', num, den: ['rq'], ...(scale !== undefined ? { scale } : {}) });
const count5m = (name: string, fields: readonly string[]) => a(name, ALL_ACTORS, 'count', { op: 'count', window: '5m', fields });
const count1h = (name: string, fields: readonly string[]) => a(name, ALL_ACTORS, 'count', { op: 'count', window: '1h', fields });

const ATTACK_OWN: readonly FeatureDef[] = [
  a('requests_1m', ALL_ACTORS, 'count', { op: 'count', window: '1m', fields: ['rq'] }),
  count5m('requests_5m', ['rq']),
  perRequest('status_401_ratio_5m', ['st:401']),
  perRequest('status_403_ratio_5m', ['st:403']),
  perRequest('status_404_ratio_5m', ['st:404']),
  perRequest('status_429_ratio_5m', ['st:429']),
  perRequest('status_5xx_ratio_5m', ['st:5xx']),
  perRequest('write_ratio_5m', ['mw']),
  count5m('odd_methods_5m', ['mo']),
  perRequest('route_auth_ratio_5m', ['rc:auth']),
  perRequest('route_admin_ratio_5m', ['rc:admin']),
  perRequest('route_export_ratio_5m', ['rc:export']),
  perRequest('route_public_ratio_5m', ['rc:public']),
  count5m('sequential_id_steps_5m', ['seq']),
  perRequest('path_depth_mean_5m', ['pd']),
  perRequest('path_entropy_mean_5m', ['pe'], 0.01),
  perRequest('params_mean_5m', ['pc']),
  perRequest('param_bytes_mean_5m', ['pb']),
  perRequest('payload_bytes_mean_5m', ['bb']),
  count5m('indicator_sql_5m', ['ix:sql']),
  count5m('indicator_script_5m', ['ix:script']),
  count5m('indicator_traversal_5m', ['ix:traversal']),
  count5m('indicator_template_5m', ['ix:template']),
  count5m('indicator_command_5m', ['ix:command']),
  perRequest('ua_bot_ratio_5m', ['ua:bot']),
  perRequest('ua_script_ratio_5m', ['ua:cli', 'ua:library']),
  perRequest('ua_empty_ratio_5m', ['ua:empty']),
  a('ua_families_1h', ALL_ACTORS, 'count', { op: 'nonzero', window: '1h', prefix: 'ua:' }),
  perRequest('header_anomaly_ratio_5m', ['hna']),
  perRequest('header_anomalies_mean_5m', ['ha']),
  perRequest('timing_regular_ratio_5m', ['tr']),
  a('asset_ratio_5m', ALL_ACTORS, 'ratio', { op: 'ratio', window: '5m', num: ['ast'], den: ['ast', 'rc:page'] }),
  a('auth_failure_ratio_5m', ALL_ACTORS, 'ratio', { op: 'ratio', window: '5m', num: ['ar:fail'], den: ['ar:ok', 'ar:fail'] }),
  count1h('auth_failures_1h', ['ar:fail']),
  a('distinct_accounts_1h', ADDRESS, 'distinct', { op: 'distinct', window: '1h', dim: 'acct' }),
  a('distinct_accounts_24h', ADDRESS, 'distinct', { op: 'distinct', window: '24h', dim: 'acct' }),
  a('distinct_endpoints_5m', ALL_ACTORS, 'distinct', { op: 'distinct', window: '5m', dim: 'ep' }),
  count1h('new_endpoints_1h', ['nep']),
  a('distinct_subjects_5m', ALL_ACTORS, 'distinct', { op: 'distinct', window: '5m', dim: 'subj' }),
  a('paging_depth_mean_5m', ALL_ACTORS, 'ratio', { op: 'ratio', window: '5m', num: ['pg'], den: ['pgn'] }),
  count5m('deep_pages_5m', ['pgd']),
  count5m('denied_signals_5m', ['o:deny']),
  count5m('failed_signals_5m', ['o:fail']),
  count1h('permission_denied_1h', ['k:permission.denied']),
  count1h('csrf_refusals_1h', ['k:security.csrf_refused']),
  count1h('login_failures_1h', ['k:auth.login_failed']),
  count1h('high_severity_signals_1h', ['sv:high', 'sv:critical']),
];

export const BEHAVIOUR_V1: FeatureCatalogue = {
  id: 'behaviour', version: 1, name: 'behaviour.v1', library: 'lightgbm', features: [...SHARED_FEATURES, ...BEHAVIOUR_OWN],
};
export const ATTACK_V1: FeatureCatalogue = {
  id: 'attack', version: 1, name: 'attack.v1', library: 'xgboost', features: [...SHARED_FEATURES, ...ATTACK_OWN],
};

/** The catalogues the store serves today (the latest version of each). */
export const FEATURE_CATALOGUES = { behaviour: BEHAVIOUR_V1, attack: ATTACK_V1 } as const;

/**
 * Every released version of each catalogue with its content hash. The newest entry must match the catalogue's hash; a changed feature
 * gets a NEW entry with the next version (never an edited hash): the test pins the released ones.
 */
export const CATALOGUE_HISTORY: Readonly<Record<FeatureCatalogue['id'], ReadonlyArray<{ version: number; hash: string }>>> = {
  behaviour: [{ version: 1, hash: '421b93f81bc4c4799ea64699a7fe6e7f4987fa50d5911c2c032bc78083f51403' }],
  attack: [{ version: 1, hash: '96158f28618a45529c38fe9b284276179b93ed642db957ab95dec222e74d444a' }],
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** The content hash of a catalogue: sha256 over its id and features (names, models, actor kinds, windows, types, sources, order). */
export function catalogueHash(catalogue: { id: string; features: readonly FeatureDef[] }): string {
  return createHash('sha256').update(canonical({ id: catalogue.id, features: catalogue.features })).digest('hex');
}

/** The names of a catalogue in model order. */
export const featureNames = (catalogue: FeatureCatalogue): string[] => catalogue.features.map((f) => f.name);
