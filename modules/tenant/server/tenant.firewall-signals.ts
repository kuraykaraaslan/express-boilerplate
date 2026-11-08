/**
 * tenant's signal kinds for the AI firewall (`ai_firewall:signal`, docs/phases/55-ai-firewall/01 §1.6): a tenant created, updated,
 * suspended, deleted or discarded and its country changed (`tenant.write.service.ts`), its maintenance windows scheduled, changed, started,
 * cancelled and ended (`auditMaintenance`), its legal hold set, cleared and expired (`tenant.legal-hold.ts`) and its data keys destroyed
 * at purge (`tenant.purge-keys.ts`). The tenant or the window is the row's subject; the tenant's name is what its owner typed (content),
 * a hold's reason is free text (content), everything else is a code, a status, a count or an id of a non-person record. The actor is the
 * operator or owner, or the system (the sweep, a control-plane command, the purge). Erasure (keys destroyed, a hold lifted, a tenant
 * deleted), a suspension, a country change (the price list) and a maintenance window that locks the tenant are medium; the rest is
 * routine. Only the contract from common is imported (ADR-0008 §2).
 */
import { auditRowSignal, signalAttr as a, type FirewallSignalContribution } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

const ACTORS = ['user', 'anon'] as const;
const NAME = { name: a.untrusted('content', 'the tenant\'s name') };
const SCOPE = { scope: a.untrusted('none', 'TENANT or SYSTEM') };
const WINDOW_MODE = { mode: a.untrusted('none', 'the maintenance mode') };
const HOLD_BY = { authority: a.untrusted('none', 'who ordered the hold'), commandJti: a.untrusted('none', 'the control-plane command') };
const HOLD_REASON = { reason: a.untrusted('content', 'the reason the operator wrote') };
const KEY_COUNTS = {
  TDEK_FAMILIES: a.number(), TDEK_DESTROYED: a.number(), TDEK_ESCROWED: a.number(), TDEK_PENDING_SLOTS: a.number(),
  TDEK_UNSHREDDED: a.number(), TDEK_RESEALED: a.number(), TDEK_UNCONVERTED: a.number(), TDEK_SHREDS_BACKUPS: a.number(), TDEK_FAILED: a.number(),
};
const KEY_REASON = { reason: a.untrusted('none', 'TENANT_PURGE or MIGRATED_AWAY') };

const SIGNALS: FirewallSignalContribution[] = [
  auditRowSignal({
    kind: 'tenant.created', severity: 'low', defaultWeight: 0.05, outcomes: ['info'], actorKinds: [...ACTORS],
    metadata: { ...NAME, slug: a.untrusted('none'), region: a.untrusted('none'), provisioned: a.flag('none', 'the tenant\'s seed ran clean') },
  }),
  auditRowSignal({ kind: 'tenant.discarded', severity: 'low', defaultWeight: 0.1, outcomes: ['info'], actorKinds: [...ACTORS], metadata: { reason: a.untrusted('none', 'a fixed sentence') } }),
  auditRowSignal({ kind: 'tenant.updated', severity: 'low', defaultWeight: 0.05, outcomes: ['info'], actorKinds: [...ACTORS], metadata: { tenantStatus: a.untrusted('none') } }),
  auditRowSignal({
    kind: 'tenant.country.changed', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: [...ACTORS],
    metadata: { from: a.untrusted('none'), to: a.untrusted('none'), fromSource: a.untrusted('none'), regionFrom: a.untrusted('none'), regionTo: a.untrusted('none') },
  }),
  auditRowSignal({ kind: 'tenant.suspended', severity: 'medium', defaultWeight: 0.3, outcomes: ['info'], actorKinds: [...ACTORS], metadata: { previousStatus: a.untrusted('none') } }),
  auditRowSignal({ kind: 'tenant.deleted', severity: 'medium', defaultWeight: 0.3, outcomes: ['info'], actorKinds: [...ACTORS], metadata: NAME }),
  auditRowSignal({
    kind: 'tenant.maintenance.scheduled', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: [...ACTORS],
    metadata: { ...SCOPE, ...WINDOW_MODE, percentage: a.number(), scheduledStart: a.untrusted('none'), scheduledEnd: a.untrusted('none') },
  }),
  auditRowSignal({ kind: 'tenant.maintenance.updated', severity: 'low', defaultWeight: 0.05, outcomes: ['info'], actorKinds: [...ACTORS], metadata: { scheduledEnd: a.untrusted('none') } }),
  auditRowSignal({
    kind: 'tenant.maintenance.started', severity: 'medium', defaultWeight: 0.25, outcomes: ['info'], actorKinds: [...ACTORS],
    metadata: { ...SCOPE, ...WINDOW_MODE, forced: a.flag('none', 'started by hand before its time') },
  }),
  auditRowSignal({ kind: 'tenant.maintenance.cancelled', severity: 'low', defaultWeight: 0.1, outcomes: ['info'], actorKinds: [...ACTORS], metadata: SCOPE }),
  auditRowSignal({ kind: 'tenant.maintenance.ended', severity: 'low', defaultWeight: 0.1, outcomes: ['info'], actorKinds: [...ACTORS], metadata: SCOPE }),
  auditRowSignal({
    kind: 'tenant.legal_hold.set', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: [...ACTORS],
    metadata: { ...HOLD_BY, ...HOLD_REASON, until: a.untrusted('none'), origin: a.untrusted('none'), outcome: a.untrusted('none') },
  }),
  auditRowSignal({
    kind: 'tenant.legal_hold.cleared', severity: 'medium', defaultWeight: 0.3, outcomes: ['info'], actorKinds: [...ACTORS],
    metadata: { ...HOLD_BY, ...HOLD_REASON, priorUntil: a.untrusted('none'), priorOrigin: a.untrusted('none') },
  }),
  auditRowSignal({ kind: 'tenant.legal_hold.expired', severity: 'low', defaultWeight: 0.1, outcomes: ['info'], actorKinds: ['anon'] }),
  auditRowSignal({
    kind: 'tenant.keys_destroyed', severity: 'medium', defaultWeight: 0.4, outcomes: ['info'], actorKinds: ['anon'],
    metadata: { ...KEY_REASON, ...KEY_COUNTS, provider: a.untrusted('none', 'the key provider') },
  }),
  auditRowSignal({ kind: 'tenant.keys_destroy_failed', severity: 'medium', defaultWeight: 0.3, outcomes: ['fail'], actorKinds: ['anon'], metadata: { ...KEY_REASON, TDEK_FAMILIES: a.number() } }),
];

export default SIGNALS;
