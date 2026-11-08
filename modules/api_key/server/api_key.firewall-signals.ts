/**
 * api_key's signal kinds for the AI firewall (`ai_firewall:signal`, docs/phases/55-ai-firewall/01 §1.6): refused keys, the dormant-key
 * anomaly (inventory §1), the per-credential throttle of phase 55 00.5, the revocations and the touches of its decoys (02.5). A key is a machine: its signals are keyed on
 * the key (actor `apiKey`, lane `machine-apikey`), never on an address (38 L-4). Only the contract from common is imported.
 */
import { auditRowSignal, signalAttr as a, type FirewallSignalContribution } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

/** A row of a key's own call is an API_KEY row (the intake's lane machine-apikey); an administrator's row about a key is a person's. */
const KEY_LANES = ['machine-apikey', 'unknown'] as const;

const SIGNALS: FirewallSignalContribution[] = [
  auditRowSignal({
    kind: 'api_key.verify.failed', severity: 'medium', defaultWeight: 0.3, outcomes: ['deny', 'fail'], lanes: KEY_LANES, actorKinds: ['apiKey', 'anon'],
    metadata: { reason: a.untrusted('none', 'inactive, expired, ip_denied, creator_not_member, wrong_tenant, throttled, ...') },
  }),
  auditRowSignal({
    kind: 'api_key.anomaly.detected', severity: 'high', defaultWeight: 0.5, outcomes: ['info'], lanes: KEY_LANES, actorKinds: ['apiKey'],
    metadata: { previousIp: a.untrusted('network', 'the address the key was last used from'), dormantDays: a.number() },
  }),
  auditRowSignal({
    kind: 'api_key.throttled', severity: 'high', defaultWeight: 0.3, outcomes: ['deny'], lanes: KEY_LANES, actorKinds: ['apiKey', 'user', 'anon'],
    metadata: {
      reason: a.untrusted(), seconds: a.number(), until: a.untrusted(), limitPerMinute: a.number(),
      enforced: a.flag('none', 'false: a flag earned by strikes that narrows nothing; true: decided by an administrator or the firewall'),
      source: a.untrusted('none', 'strikes, admin or firewall'), strikes: a.number(), offense: a.number(),
    },
  }),
  auditRowSignal({ kind: 'api_key.throttle_cleared', severity: 'medium', defaultWeight: 0.02, outcomes: ['info'], lanes: KEY_LANES, actorKinds: ['user', 'anon'], metadata: { source: a.untrusted() } }),
  auditRowSignal({ kind: 'api_key.created', severity: 'low', defaultWeight: 0.2, outcomes: ['info'], metadata: { name: a.untrusted('none', 'the key\'s name'), environment: a.untrusted() } }),
  auditRowSignal({ kind: 'api_key.revoke_all', severity: 'low', defaultWeight: 0.2, outcomes: ['info'], metadata: { revokedCount: a.number() } }),
  auditRowSignal({ kind: 'api_key.rotated', severity: 'low', defaultWeight: 0.05, outcomes: ['info'], actorKinds: ['user', 'anon'], metadata: { successorKeyId: a.untrusted('none'), graceSeconds: a.number() } }),
  // a key's permissions, scopes, expiry or activation changed: what a machine may do, weighed like a credential write
  auditRowSignal({
    kind: 'api_key.updated', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: ['user', 'anon'],
    metadata: { isActive: a.flag('none', 'the key is active after the change'), expiresAt: a.untrusted('none', 'the new expiry, when one was given') },
  }),
  auditRowSignal({ kind: 'api_key.deleted', severity: 'low', defaultWeight: 0.05, outcomes: ['info'], metadata: { name: a.untrusted('none', 'the key\'s name') } }),
  // Phase 55 02.5: the decoys (api_key.decoy.ts, api_key.firewall-honeytokens.ts). Emitted by this module, not audit rows; a touch is never
  // legitimate, so each is critical and a high-precision label for 03.
  {
    kind: 'api_key.decoy_touched', emitted: true, severity: 'critical', defaultWeight: 1, outcomes: ['deny'],
    // the decoy is no credential: its caller is anonymous public traffic, keyed on its address
    lanes: ['public-anon'], actorKinds: ['ip', 'anon'],
    attrs: {
      keyEnv: a.text('none', 'live or test: the environment the decoy key names'),
      addressedOwnTenant: a.flag('none', 'false: the decoy of one workspace was presented to another; null: the verifier did not know'),
      scopeAsked: a.text('none', 'the scope the endpoint asked of the key, if any'),
    },
  },
  {
    kind: 'api_key.decoy_record_touched', emitted: true, severity: 'critical', defaultWeight: 1, outcomes: ['deny'],
    lanes: ['human-web', 'human-native', 'machine-apikey', 'unknown'], actorKinds: ['user', 'apiKey', 'anon'],
    attrs: { method: a.text('none', 'GET, PUT, DELETE or POST (rotate)') },
  },
];

export default SIGNALS;
