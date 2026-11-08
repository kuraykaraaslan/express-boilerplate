/**
 * tenant_member's decoy for the AI firewall (`ai_firewall:honeytoken`, docs/phases/55-ai-firewall/02 §2.5): the canary member record of
 * each tenant (tenant_member.decoy.ts). Derived, never stored: `plant` derives the tenant's id for the canary list and changes nothing.
 * Only the contract from common is imported at load.
 */
import type { HoneytokenContribution, PlantedHoneytoken } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

const HONEYTOKENS: HoneytokenContribution[] = [
  {
    id: 'tenant_member.decoy_record',
    kind: 'record',
    labelKey: 'tenant_member.firewallHoneytoken.decoy_record.label',
    descriptionKey: 'tenant_member.firewallHoneytoken.decoy_record.description',
    detector: { signalKind: 'tenant_member.decoy_record_touched' },
    async plant(tenantId: string | null): Promise<PlantedHoneytoken | null> {
      if (!tenantId) return null;
      const id = (await import('./tenant_member.decoy')).decoyMemberIdFor(tenantId);
      return id ? { ref: id, bait: id, where: '/api/members/<id>' } : null;
    },
  },
];

export default HONEYTOKENS;
