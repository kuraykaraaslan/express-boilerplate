import type { ActorKind } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';
import { catalogueHash, type FeatureDef, type FeatureSource, type FeatureType } from './ai_firewall.feature-catalogue';
import type { VectorCatalogue } from './ai_firewall.feature-vector';
import type { WindowId } from './ai_firewall.feature-windows';

/**
 * `rules.v1`: the features only the rule scorer and the detectors read (docs/phases/55-ai-firewall/02 §2.2, §2.3), never a model. The
 * two model catalogues (`behaviour.v1`, `attack.v1`) stay as they were trained on; what a detector needs beyond them (sign-ups, key and
 * role changes, platform-admin grants, impersonations, refresh-token reuse, device credential blocks, a gateway's created and refused
 * children (v2, D443), the registry-weighted signal mass)
 * is defined here, ONCE, with the same closed set of operations (`ai_firewall.feature-vector.ts`), assembled from the same windows read.
 *
 * Its names are disjoint from both model catalogues (test), so a contribution names one feature of one catalogue, and the explanation
 * key `ai_firewall.explain.<feature>` (04.10) is unambiguous. Its content hash is pinned like theirs (`RULES_HISTORY`): a change needs the
 * next version, because a scored detection records the catalogue it was scored with.
 *
 * Signal kinds are the registered ones (`k:<kind>`, ai_firewall.signal-fold.ts); a kind no module registers counts as `other`, so a
 * feature over it reads 0, never an error.
 */

const ALL: readonly ActorKind[] = ['user', 'session', 'ip', 'apiKey', 'device', 'node', 'anon'];
const PERSON: readonly ActorKind[] = ['user', 'session'];
const PERSON_AND_KEY: readonly ActorKind[] = ['user', 'session', 'apiKey'];
const MACHINE: readonly ActorKind[] = ['device', 'node'];

const r = (name: string, actorKinds: readonly ActorKind[], type: FeatureType, source: Extract<FeatureSource, { window: WindowId }>): FeatureDef =>
  ({ name, model: 'rules', actorKinds, window: source.window, type, source });
const count = (name: string, actorKinds: readonly ActorKind[], window: WindowId, fields: readonly string[]) =>
  r(name, actorKinds, 'count', { op: 'count', window, fields });

/** Every sign-in refusal kind of a password, ACS or SAML sign-in. */
export const LOGIN_FAILURE_KINDS = ['auth.login_failed', 'acs.login_failed', 'saml.login_failed'] as const;
const k = (kinds: readonly string[]) => kinds.map((kind) => `k:${kind}`);

const RULES_OWN: readonly FeatureDef[] = [
  r('signal_weight_1h', ALL, 'number', { op: 'signalWeight', window: '1h' }),
  count('logins_1h', ['user', 'session', 'ip'], '1h', k(['user_session.login'])),
  count('login_failures_24h', ['user', 'session', 'ip', 'anon'], '24h', k(LOGIN_FAILURE_KINDS)),
  r('distinct_accounts_5m', ['ip'], 'distinct', { op: 'distinct', window: '5m', dim: 'acct' }),
  count('signups_1h', ['ip', 'user'], '1h', k(['auth.register'])),
  count('signups_24h', ['ip', 'user'], '24h', k(['auth.register'])),
  count('workspaces_created_24h', ['ip', 'user'], '24h', k(['tenant.self_service_created'])),
  count('api_keys_created_1h', PERSON, '1h', k(['api_key.created'])),
  count('export_requests_24h', PERSON_AND_KEY, '24h', ['rc:export']),
  count('role_changes_1h', PERSON, '1h', k(['user.role_changed', 'scim.member.role_changed', 'tenant_member.ownership_transferred'])),
  count('policy_changes_1h', PERSON, '1h', k(['abac.policy.created', 'abac.policy.updated', 'abac.policy.deleted'])),
  count('member_removals_1h', PERSON, '1h', k(['tenant_member.deleted', 'tenant_member.suspended'])),
  count('platform_admin_grants_24h', PERSON, '24h', k(['user.platform_admin_granted'])),
  count('impersonations_24h', PERSON, '24h', k(['impersonation.started'])),
  count('security_downgrades_24h', PERSON, '24h', k(['security.mfa_disabled', 'auth.two_factor_reset_by_admin'])),
  count('refresh_reuses_24h', PERSON, '24h', k(['user_session.refresh_reused'])),
  count('geo_anomalies_24h', PERSON, '24h', k(['tenant.session.geo_anomaly'])),
  count('key_verify_failures_1h', ['ip', 'anon', 'apiKey'], '1h', k(['api_key.verify.failed'])),
  count('key_anomalies_24h', ['apiKey'], '24h', k(['api_key.anomaly.detected', 'api_key.throttled'])),
  count('device_auth_blocks_1h', ['ip', 'anon', 'device', 'node'], '1h', k(['iot_gateway.auth_blocked'])),
  count('device_recoveries_24h', ['ip', 'anon', 'device', 'node'], '24h', k(['iot_pki.recovery.attempted'])),
  // v2 (D443): children a gateway reported that the platform created, or refused (at most one row per reason an hour), weighed against
  // the gateway
  count('gateway_children_created_24h', MACHINE, '24h', k(['iot_device.child.created'])),
  count('gateway_child_refusals_24h', MACHINE, '24h', k(['iot_device.child.refused'])),
  r('device_addresses_1h', MACHINE, 'distinct', { op: 'distinct', window: '1h', dim: 'addr' }),
  count('device_events_1m', MACHINE, '1m', ['s', 'rq']),
];

export interface RuleCatalogue extends VectorCatalogue {
  id: 'rules';
  version: number;
  name: string;
  features: readonly FeatureDef[];
}

export const RULES_V1: RuleCatalogue = { id: 'rules', version: 2, name: 'rules.v1', features: RULES_OWN };

/** Released versions of rules.v1 with their content hash; a change appends the next version (the test pins the released ones). */
export const RULES_HISTORY: ReadonlyArray<{ version: number; hash: string }> = [
  { version: 1, hash: '9b9ff44e4041c381d1c73f1deed71502f7531103c165f13d69cae426cf9401fa' },
  { version: 2, hash: 'b3317f27e5e46040346ff0c7436b91e6fe485d8913313a3fa631f4fd2acccb0d' },
];

export const rulesHash = (): string => catalogueHash(RULES_V1);
