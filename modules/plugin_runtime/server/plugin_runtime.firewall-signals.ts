/**
 * plugin_runtime's signal kinds for the AI firewall (`ai_firewall:signal`, docs/phases/55-ai-firewall/01 §1.6): a plugin run stopped at
 * one of the sandbox's bounds (phase 55 00.3: a timeout, the memory limit, a result or payload cap, too many host calls in flight),
 * aggregated per plugin version and minute. Only the contract from common is imported (ADR-0008 §2).
 */
import {
  REFUSAL_ROW_METADATA,
  auditRowSignal,
  signalAttr as a,
  type FirewallSignalContribution,
} from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

const SIGNALS: FirewallSignalContribution[] = [
  auditRowSignal({
    kind: 'plugin.sandbox_violation', severity: 'high', defaultWeight: 0.4, outcomes: ['deny'], actorKinds: ['user', 'anon'],
    metadata: {
      ...REFUSAL_ROW_METADATA,
      pluginId: a.untrusted('none'), violation: a.untrusted('none', 'timeout, memory_limit, result_cap, host_payload_cap, host_calls_in_flight'),
      kind: a.untrusted('none', 'what ran: a hook, an action, a route'), target: a.untrusted('none'),
    },
  }),
];

export default SIGNALS;
