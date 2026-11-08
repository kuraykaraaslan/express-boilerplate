/**
 * api_key's decoys for the AI firewall (`ai_firewall:honeytoken`, docs/phases/55-ai-firewall/02 §2.5): the decoy key and the decoy key
 * record of each tenant (api_key.decoy.ts). Both are derived, never stored: `plant` derives the tenant's value for the canary list and
 * changes nothing, so there is nothing to remove. Only the contract from common is imported at load; the derivation is loaded on use.
 */
import type { HoneytokenContribution, PlantedHoneytoken } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

const decoys = () => import('./api_key.decoy');

const HONEYTOKENS: HoneytokenContribution[] = [
  {
    id: 'api_key.decoy_key',
    kind: 'api_key',
    labelKey: 'api_key.firewallHoneytoken.decoy_key.label',
    descriptionKey: 'api_key.firewallHoneytoken.decoy_key.description',
    detector: { signalKind: 'api_key.decoy_touched' },
    async plant(tenantId: string | null): Promise<PlantedHoneytoken | null> {
      if (!tenantId) return null;
      const [{ decoyKeyFor, maskDecoyKey }, { DEFAULT_KEY_ENV }] = await Promise.all([decoys(), import('./api_key.crypto')]);
      const raw = decoyKeyFor(tenantId, DEFAULT_KEY_ENV);
      return raw ? { ref: maskDecoyKey(raw), bait: raw } : null;
    },
  },
  {
    id: 'api_key.decoy_record',
    kind: 'record',
    labelKey: 'api_key.firewallHoneytoken.decoy_record.label',
    descriptionKey: 'api_key.firewallHoneytoken.decoy_record.description',
    detector: { signalKind: 'api_key.decoy_record_touched' },
    async plant(tenantId: string | null): Promise<PlantedHoneytoken | null> {
      if (!tenantId) return null;
      const id = (await decoys()).decoyRecordIdFor(tenantId);
      return id ? { ref: id, bait: id, where: '/api/api-keys/<id>' } : null;
    },
  },
];

export default HONEYTOKENS;
