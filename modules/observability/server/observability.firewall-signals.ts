/**
 * observability's signal kinds for the AI firewall (`ai_firewall:signal`, docs/phases/55-ai-firewall/01 §1.6): chat destinations (Slack,
 * Teams) connected, changed, tested, removed or switched off; configuration applied from code or detached from it; an incident put on or
 * taken off legal hold; probe locations, their enrolment tokens and runners; an SLA report exported; browser telemetry keys, attribute
 * comparison, retention and an erasure of the workspace's telemetry. The destination, location, runner, incident or workspace is the row's
 * subject; the actor is the administrator, an API key (configuration as code) or the system (a destination switched off, a runner
 * enrolling with its token, retention clamped to the plan). No URL, token or key is ever in a row: a host, a key's id, a fingerprint.
 * Arrays and objects (allow-lists, before and after, counts by kind) never travel, so they are not declared. A Pro module: it contributes
 * from its own folder and imports only the contract from common.
 */
import { auditRowSignal, signalAttr as a, type FirewallSignalContribution } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

const ACTORS = ['user', 'anon'] as const;
const CHAT = {
  kind: a.untrusted('none', 'slack or teams'), label: a.untrusted('content', 'the name the administrator gave the destination'),
  host: a.untrusted('network', 'the webhook URL\'s host, never the URL'),
};
const LOCATION = { key: a.untrusted('none', 'the probe location key') };
const RUNNER = { locationKey: a.untrusted('none'), fingerprint: a.untrusted('none', 'the runner key\'s fingerprint') };

const SIGNALS: FirewallSignalContribution[] = [
  // a chat destination is an outgoing webhook: alerts and incident details leave for it
  auditRowSignal({
    kind: 'observability.chat.destination_created', severity: 'medium', defaultWeight: 0.25, outcomes: ['info'], actorKinds: ['user'],
    metadata: { ...CHAT, audience: a.untrusted('none'), enabled: a.flag() },
  }),
  auditRowSignal({ kind: 'observability.chat.destination_updated', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: ['user'], metadata: { ...CHAT, audience: a.untrusted('none') } }),
  auditRowSignal({ kind: 'observability.chat.destination_deleted', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: ['user'], metadata: CHAT }),
  auditRowSignal({ kind: 'observability.chat.destination_tested', severity: 'low', defaultWeight: 0.05, outcomes: ['info'], actorKinds: ['user'], metadata: { kind: CHAT.kind, host: CHAT.host, result: a.untrusted('none', 'sent or the failure code') } }),
  auditRowSignal({
    kind: 'observability.chat.destination_suspended', severity: 'low', defaultWeight: 0.1, outcomes: ['info'], actorKinds: ['anon'],
    metadata: { kind: CHAT.kind, host: CHAT.host, reason: a.untrusted('none', 'gone or consecutive_failures'), code: a.untrusted('none') },
  }),
  // configuration as code rewrites monitors, alert rules and status pages in one go: weighed like a bulk change
  auditRowSignal({ kind: 'observability.config.applied', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: ['user', 'apiKey'] }),
  auditRowSignal({
    kind: 'observability.config.detached', severity: 'low', defaultWeight: 0.05, outcomes: ['info'], actorKinds: ['user', 'apiKey'],
    metadata: { kind: a.untrusted('none', 'the configuration kind'), key: a.untrusted('none', 'the resource\'s key in the configuration') },
  }),
  auditRowSignal({ kind: 'observability.incident.legal_hold_set', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: ['user'], metadata: { held: a.flag(), reason: a.untrusted('content', 'the reason the administrator typed') } }),
  // releasing a hold lets the incident's records age out again
  auditRowSignal({ kind: 'observability.incident.legal_hold_released', severity: 'medium', defaultWeight: 0.25, outcomes: ['info'], actorKinds: ['user'], metadata: { held: a.flag(), reason: a.untrusted('content', 'the reason the administrator typed') } }),
  auditRowSignal({
    kind: 'observability.probe.location_created', severity: 'low', defaultWeight: 0.05, outcomes: ['info'], actorKinds: ['user'],
    metadata: { ...LOCATION, kind: a.untrusted('none', 'PUBLIC or PRIVATE'), browserEnabled: a.flag() },
  }),
  // what a private location may reach is its allow-list: the change records both sides
  auditRowSignal({ kind: 'observability.probe.location_updated', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: ['user'], metadata: LOCATION }),
  auditRowSignal({ kind: 'observability.probe.location_deleted', severity: 'low', defaultWeight: 0.1, outcomes: ['info'], actorKinds: ['user'], metadata: LOCATION }),
  auditRowSignal({ kind: 'observability.probe.location_exposure_changed', severity: 'low', defaultWeight: 0.1, outcomes: ['info'], actorKinds: ['user'], metadata: LOCATION }),
  // an enrolment token lets a machine join as the tenant's runner: weighed like a credential minted
  auditRowSignal({ kind: 'observability.probe.enrolment_created', severity: 'medium', defaultWeight: 0.3, outcomes: ['info'], actorKinds: ['user'], metadata: { ...LOCATION, expiresAt: a.untrusted('none') } }),
  auditRowSignal({
    kind: 'observability.probe.runner_enrolled', severity: 'medium', defaultWeight: 0.25, outcomes: ['info'], actorKinds: ['anon'],
    metadata: { ...RUNNER, name: a.untrusted('none', 'the name the runner reported') },
  }),
  auditRowSignal({ kind: 'observability.probe.runner_revoked', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: ['user'], metadata: RUNNER }),
  auditRowSignal({
    kind: 'observability.sla_report.exported', severity: 'medium', defaultWeight: 0.25, outcomes: ['info'], actorKinds: [...ACTORS],
    metadata: { from: a.untrusted('none'), to: a.untrusted('none'), format: a.untrusted('none'), rows: a.number('none') },
  }),
  // a browser key is an API key the page ships: its origins and rate decide who may write telemetry with it
  auditRowSignal({ kind: 'observability.telemetry.browser_key_set', severity: 'medium', defaultWeight: 0.3, outcomes: ['info'], actorKinds: ['user'], metadata: { apiKeyId: a.untrusted('none'), ratePerMinute: a.number('none') } }),
  auditRowSignal({ kind: 'observability.telemetry.browser_key_removed', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: ['user'], metadata: { apiKeyId: a.untrusted('none') } }),
  auditRowSignal({ kind: 'observability.telemetry.compare_set', severity: 'low', defaultWeight: 0.03, outcomes: ['info'], actorKinds: ['user'], metadata: { enabled: a.flag() } }),
  auditRowSignal({ kind: 'observability.telemetry.retention_set', severity: 'low', defaultWeight: 0.1, outcomes: ['info'], actorKinds: ['user'], metadata: { days: a.number('none') } }),
  auditRowSignal({ kind: 'observability.telemetry.retention_clamped', severity: 'low', defaultWeight: 0.05, outcomes: ['info'], actorKinds: ['anon'], metadata: { from: a.number('none'), to: a.number('none') } }),
  // the workspace's logs, traces and metrics erased: an erasure
  auditRowSignal({
    kind: 'observability.telemetry.erased', severity: 'medium', defaultWeight: 0.35, outcomes: ['info'], actorKinds: ['user'],
    metadata: { signals: a.untrusted('none', 'all, when every signal was erased'), state: a.untrusted('none'), removed: a.number('none') },
  }),
];

export default SIGNALS;
