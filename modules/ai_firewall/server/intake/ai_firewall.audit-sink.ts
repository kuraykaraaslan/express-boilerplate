import { emitSecuritySignal } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';
import type { AuditRecordSink } from '@kuraykaraaslan-labs/audit_log/server/audit_log.record-sink';
import { auditRecordToSignal, isActorlessRow, systemRowActorsOf, type SystemRowActorMap } from './ai_firewall.signal-mapping';

/**
 * `audit_log:record_sink` contribution (docs/phases/55-ai-firewall/01 §1.4a): every written audit row becomes a `SecuritySignal` in
 * the `fw:signals` stream. Hears every row (no `actions` filter): which kinds matter is the registry's and the consumer's call (1.5, 02),
 * and a row the firewall does not know is still a data point of the actor's baseline.
 *
 * Nothing is stored here (the consumer of step 02 stores). `emitSecuritySignal` is synchronous and never throws, and the host runs this
 * detached after the row committed, so the audited operation never waits for it (FWA-7). It writes no audit row (that would loop).
 *
 * D443: a row without an actor is weighed against the record its kind declares (`systemRowActor`: its subject or a metadata id). The
 * declarations come from the signal catalogue, read once per process; a row with an actor (nearly every row) never waits for it, an
 * actorless one waits only for the first read. An unreadable registry maps the row as before (address or `anon`), and the next
 * actorless row tries again.
 */
export function auditSignalSink(loadSystemRowActors: () => Promise<SystemRowActorMap>): AuditRecordSink {
  let resolved: SystemRowActorMap | null = null;
  let loading: Promise<SystemRowActorMap | null> | null = null;
  const systemRowActors = (): Promise<SystemRowActorMap | null> =>
    (loading ??= loadSystemRowActors().then((map) => (resolved = map)).catch(() => { loading = null; return null; }));

  return {
    key: 'ai_firewall_signals',
    onRecord(record) {
      if (resolved || !isActorlessRow(record)) {
        emitSecuritySignal(auditRecordToSignal(record, resolved));
        return;
      }
      return systemRowActors().then((map) => { emitSecuritySignal(auditRecordToSignal(record, map)); });
    },
  };
}

const sink = auditSignalSink(async () => {
  const { firewallRegistry } = await import('../registry/ai_firewall.registry');
  return systemRowActorsOf((await firewallRegistry()).catalog.signals.values());
});

export default sink;
