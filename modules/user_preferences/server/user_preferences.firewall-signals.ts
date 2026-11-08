/**
 * user_preferences' signal kind for the AI firewall (`ai_firewall:signal`, docs/phases/55-ai-firewall/01 §1.6): a person's preferences
 * changed (language, theme, notification channels and the like). Routine and the person's own: the lightest kind. The person is the
 * row's subject; the actor is the person (or whoever changed it for them). The changes travel as an object, which never reaches a
 * signal, so no field is declared. It contributes from its own folder and imports only the contract from common.
 */
import { auditRowSignal, type FirewallSignalContribution } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

const SIGNALS: FirewallSignalContribution[] = [
  auditRowSignal({ kind: 'user_preferences.updated', severity: 'low', defaultWeight: 0.02, outcomes: ['info'], actorKinds: ['user'] }),
];

export default SIGNALS;
