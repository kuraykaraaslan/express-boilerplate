/**
 * feature_gate's signal kinds for the AI firewall (`ai_firewall:signal`, docs/phases/55-ai-firewall/01 §1.6): a plan feature checked (one
 * row per tenant, feature and answer in a window, `feature_gate.cache.ts`), a creation refused by a deployment cap of the licence
 * (`fleet.license.limit_blocked`, written for tenant, module_lifecycle and fleet under the root tenant) and a ticket issued for a
 * protected pack, the paid content served behind it (every served copy is traced to its ticket's mark). The actor is the person or the
 * system (a screen, for a pack a display link asked for). Only the contract from common is imported.
 */
import { auditRowSignal, signalAttr as a, type FirewallSignalContribution } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

const ACTORS = ['user', 'anon'] as const;
const FEATURE = { featureKey: a.untrusted('none', 'the plan feature or licence cap') };

const SIGNALS: FirewallSignalContribution[] = [
  auditRowSignal({
    kind: 'feature.access.checked', severity: 'low', defaultWeight: 0.02, outcomes: ['info'], actorKinds: ['anon'],
    metadata: {
      ...FEATURE, allowed: a.flag(), type: a.untrusted('none', 'BOOLEAN or LIMIT'), declared: a.flag('none', 'a live entitlement named the key'),
      limit: a.number(), unlimited: a.flag(), current: a.number(), gracePercent: a.number(), effectiveLimit: a.number(), inGrace: a.flag(),
    },
  }),
  // the licence of the deployment refused a new tenant, module activation, node or region: platform control
  auditRowSignal({
    kind: 'fleet.license.limit_blocked', severity: 'medium', defaultWeight: 0.2, outcomes: ['deny'], actorKinds: [...ACTORS],
    metadata: {
      ...FEATURE, limit: a.number(), current: a.number(), enforcedBy: a.untrusted('none', 'tenant, module_lifecycle or fleet'),
      forTenantId: a.untrusted('none', 'the tenant the creation was for'), moduleId: a.untrusted('none'), path: a.untrusted('none', 'how the tenant was being created'),
      regionId: a.untrusted('none'), nodeId: a.untrusted('none'),
    },
  }),
  // a download of paid content: weighed like an export
  auditRowSignal({
    kind: 'feature_gate.pack.ticket', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: [...ACTORS],
    metadata: {
      module: a.untrusted('none', 'the module that owns the packs'), mark: a.untrusted('none', 'the mark written into every served copy'),
      subject: a.untrusted('identifier', 'u:<the person> or d:<the display link>'), expiresAt: a.number('none', 'the ticket\'s expiry, in seconds'),
    },
  }),
];

export default SIGNALS;
