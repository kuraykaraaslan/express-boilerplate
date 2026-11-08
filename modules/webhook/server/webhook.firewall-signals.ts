/**
 * webhook's signal kinds for the AI firewall (`ai_firewall:signal`, docs/phases/55-ai-firewall/01 §1.6): an endpoint created, updated,
 * deleted and its signing secret rotated (`auditWebhook`, webhook.crud.service.ts); a delivery redelivered, an endpoint's dead letters
 * replayed, a test sent and a catalog event triggered by hand (webhook.redeliver.service.ts). The endpoint is the row's subject; its name
 * is what a member typed (content), its URL an address (network), the rest ids, event names, flags and numbers. The actor is the member,
 * or the system. A webhook is a channel that carries the workspace's events off the box and a rotation hands out a new secret: medium for
 * what changes the channel or sends real events again (a new endpoint, a rotation and a bulk replay the heaviest), low for the test and
 * the sample event, which carry no workspace data. Only the contract from common is imported (ADR-0008 §2).
 */
import { auditRowSignal, signalAttr as a, type FirewallSignalContribution } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

const ACTORS = ['user', 'anon'] as const;
const NAME = { name: a.untrusted('content', 'the endpoint\'s name') };

const SIGNALS: FirewallSignalContribution[] = [
  auditRowSignal({
    kind: 'webhook.created', severity: 'medium', defaultWeight: 0.3, outcomes: ['info'], actorKinds: [...ACTORS],
    metadata: { ...NAME, url: a.untrusted('network', 'the endpoint the events go to') },
  }),
  auditRowSignal({ kind: 'webhook.updated', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: [...ACTORS], metadata: { isActive: a.flag() } }),
  auditRowSignal({ kind: 'webhook.deleted', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: [...ACTORS], metadata: NAME }),
  // a real event's payload sent off the box again; a replay sends every dead letter of the endpoint in one act
  auditRowSignal({
    kind: 'webhook.delivery_redelivered', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: [...ACTORS],
    metadata: { deliveryId: a.untrusted('none'), event: a.untrusted('none', 'the event the delivery carries'), previousStatus: a.untrusted('none', 'the delivery\'s status before') },
  }),
  auditRowSignal({
    kind: 'webhook.dead_letters_replayed', severity: 'medium', defaultWeight: 0.3, outcomes: ['info'], actorKinds: [...ACTORS],
    metadata: { replayed: a.number('none', 'deliveries queued again'), skipped: a.number('none', 'deliveries another request claimed first'), failedDeliveryId: a.untrusted('none', 'where a failed hand-off stopped the replay') },
  }),
  auditRowSignal({
    kind: 'webhook.test_sent', severity: 'low', defaultWeight: 0.05, outcomes: ['info'], actorKinds: [...ACTORS],
    metadata: { deliveryId: a.untrusted('none'), status: a.untrusted('none', 'the test delivery\'s status'), responseStatus: a.number('none', 'the endpoint\'s HTTP status') },
  }),
  auditRowSignal({
    kind: 'webhook.event_triggered', severity: 'low', defaultWeight: 0.1, outcomes: ['info'], actorKinds: [...ACTORS],
    metadata: { event: a.untrusted('none', 'the catalog event sent with its sample payload'), deliveryId: a.untrusted('none') },
  }),
  auditRowSignal({ kind: 'webhook.secret_rotated', severity: 'medium', defaultWeight: 0.3, outcomes: ['info'], actorKinds: [...ACTORS], metadata: { overlapMs: a.number('none', 'how long the previous secret stays valid') } }),
];

export default SIGNALS;
