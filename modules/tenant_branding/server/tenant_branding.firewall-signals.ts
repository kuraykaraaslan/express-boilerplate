/**
 * tenant_branding's signal kinds for the AI firewall (`ai_firewall:signal`, docs/phases/55-ai-firewall/01 §1.6): branding presets
 * created, updated, deleted and applied to a workspace (`tenant_branding.preset.service.ts`). The preset is the row's subject; its name is
 * what an operator typed (content), the tenant ids are not people. The actor is the operator, or the system. Applying a preset rewrites
 * another workspace's logos and colours (what its sign-in page shows): medium, like `settings.updated`; a delete is low, the rest routine.
 * `settings.updated`, which the branding service also writes, is audit_log's (D55-160). Only the contract from common is imported
 * (ADR-0008 §2).
 */
import { auditRowSignal, signalAttr as a, type FirewallSignalContribution } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

const ACTORS = ['user', 'anon'] as const;
const OWNER = { tenantId: a.untrusted('none', 'the preset owner\'s tenant') };

const SIGNALS: FirewallSignalContribution[] = [
  auditRowSignal({ kind: 'tenant_branding.preset_created', severity: 'low', defaultWeight: 0.03, outcomes: ['info'], actorKinds: [...ACTORS], metadata: { ...OWNER, name: a.untrusted('content', 'the preset\'s name') } }),
  auditRowSignal({ kind: 'tenant_branding.preset_updated', severity: 'low', defaultWeight: 0.03, outcomes: ['info'], actorKinds: [...ACTORS], metadata: OWNER }),
  auditRowSignal({ kind: 'tenant_branding.preset_deleted', severity: 'low', defaultWeight: 0.1, outcomes: ['info'], actorKinds: [...ACTORS], metadata: OWNER }),
  auditRowSignal({
    kind: 'tenant_branding.preset_applied', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: [...ACTORS],
    metadata: { ...OWNER, targetTenantId: a.untrusted('none', 'the workspace the preset was applied to') },
  }),
];

export default SIGNALS;
