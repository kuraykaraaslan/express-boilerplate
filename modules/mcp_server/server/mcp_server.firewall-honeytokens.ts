/**
 * mcp_server's decoy for the AI firewall (`ai_firewall:honeytoken`, docs/phases/57-mcp-server D57-11): the decoy MCP access token of each
 * workspace (oauth/mcp_oauth.decoy.ts). Derived, never stored or issued: `plant` derives the tenant's value for the canary list and
 * changes nothing. Presenting it on an MCP server is one critical signal.
 */
import type { HoneytokenContribution, PlantedHoneytoken } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

const HONEYTOKENS: HoneytokenContribution[] = [
  {
    id: 'mcp_server.decoy_token',
    kind: 'credential',
    labelKey: 'mcp_server.firewallHoneytoken.decoy_token.label',
    descriptionKey: 'mcp_server.firewallHoneytoken.decoy_token.description',
    detector: { signalKind: 'mcp_server.decoy_token_touched' },
    async plant(tenantId: string | null): Promise<PlantedHoneytoken | null> {
      if (!tenantId) return null;
      const raw = (await import('./oauth/mcp_oauth.decoy')).decoyTokenFor(tenantId);
      return raw ? { ref: `${raw.slice(0, 12)}…`, bait: raw, where: 'Authorization: Bearer on /api/mcp/<server>' } : null;
    },
  },
];

export default HONEYTOKENS;
