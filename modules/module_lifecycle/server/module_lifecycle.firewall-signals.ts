/**
 * module_lifecycle's signal kinds for the AI firewall (`ai_firewall:signal`, docs/phases/55-ai-firewall/01 §1.6): a module installed,
 * activated, deactivated, uninstalled, restored inside its window and deleted with its data (named `marketplace.*`, the catalogue's
 * actions, but written and registered here); a tenant's module policy blocking or unblocking a module; the platform changing a module's
 * availability, banning it and lifting the ban. The module is the row's subject; no person is in the metadata (module ids, reasons the
 * operator chose, counts). The actor is the administrator or the platform operator, or the system (a dependency, the retirement sweep).
 * Turning a module on or off changes what code runs and which controls hold (the firewall and the audit trail are modules too), and a
 * delete purges its tables: platform control and purge, medium. Arrays (the modules installed, the tables purged, the dependents) never
 * travel on a signal and are not declared. Only the contract from common is imported (ADR-0008 §2).
 */
import { auditRowSignal, signalAttr as a, type FirewallSignalContribution } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

const ACTORS = ['user', 'anon'] as const;
const REASON = { reason: a.untrusted('content', 'the reason the operator wrote') };

const SIGNALS: FirewallSignalContribution[] = [
  auditRowSignal({ kind: 'marketplace.install', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: [...ACTORS], metadata: { origin: a.untrusted('none', 'tenant, dependency or platform') } }),
  auditRowSignal({ kind: 'marketplace.activate', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: [...ACTORS] }),
  auditRowSignal({ kind: 'marketplace.deactivate', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: [...ACTORS], metadata: { closedReason: a.untrusted('none', 'why the module was closed') } }),
  auditRowSignal({ kind: 'marketplace.uninstall', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: [...ACTORS], metadata: { restorableUntil: a.untrusted('none') } }),
  auditRowSignal({ kind: 'marketplace.restore', severity: 'low', defaultWeight: 0.1, outcomes: ['info'], actorKinds: [...ACTORS] }),
  // the module's tables are purged for good
  auditRowSignal({
    kind: 'marketplace.delete', severity: 'medium', defaultWeight: 0.3, outcomes: ['info'], actorKinds: [...ACTORS],
    metadata: { rowsDeleted: a.number(), referencesSwept: a.number(), referencesNotSwept: a.number() },
  }),
  auditRowSignal({ kind: 'module.policy.block', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: [...ACTORS], metadata: REASON }),
  auditRowSignal({ kind: 'module.policy.unblock', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: [...ACTORS] }),
  auditRowSignal({
    kind: 'module.availability.changed', severity: 'medium', defaultWeight: 0.3, outcomes: ['info'], actorKinds: [...ACTORS],
    metadata: { state: a.untrusted('none', 'the availability state'), ...REASON },
  }),
  auditRowSignal({ kind: 'module_lifecycle.module.banned', severity: 'medium', defaultWeight: 0.3, outcomes: ['deny'], actorKinds: [...ACTORS], metadata: REASON }),
  auditRowSignal({ kind: 'module_lifecycle.module.ban_lifted', severity: 'medium', defaultWeight: 0.3, outcomes: ['info'], actorKinds: [...ACTORS], metadata: REASON }),
];

export default SIGNALS;
