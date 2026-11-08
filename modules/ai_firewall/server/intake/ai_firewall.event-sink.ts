import { emitSecuritySignal } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';
import type { WebhookEventSink } from '@kuraykaraaslan-labs/webhook/server/webhook.event-sink';
import { domainEventToSignal } from './ai_firewall.signal-mapping';

/**
 * `webhook:event_sink` contribution (docs/phases/55-ai-firewall/01 §1.4b): every dispatched domain event becomes an `event.<name>`
 * `SecuritySignal` in the `fw:signals` stream. Hears every event (no `names` filter), except `audit.*`: those are audit rows the record
 * sink already heard (`audit.high_risk` would otherwise arrive twice).
 *
 * Only identifiers and codes of the payload travel (`domainEventToSignal`'s allow list): a payload can carry a setting's value or a form.
 * Nothing is stored here; `emitSecuritySignal` never waits and never throws, and `dispatchEvent` runs this detached (FWA-7).
 */
const sink: WebhookEventSink = {
  key: 'ai_firewall_signals',
  onEvent(tenantId, event, payload, meta) {
    const signal = domainEventToSignal(tenantId, event, payload, meta);
    if (signal) emitSecuritySignal(signal);
  },
};

export default sink;
