/**
 * The decoy MCP access token of each workspace (`ai_firewall:honeytoken` `mcp_server.decoy_token`, docs/phases/57-mcp-server D57-11):
 * shaped like a real access token, derived from the server's decoy key and the tenant id (never stored, never issued), listed only in
 * the firewall's canary list. Presenting it is answered like any unknown token (401) and is one critical signal for its workspace:
 * nobody legitimate can hold it.
 */
import { timingSafeEqual } from 'node:crypto';
import { decoyMac } from '@kuraykaraaslan-labs/common/server/common.firewall-decoys';
import { emitHoneytokenTouch, type ActorRef } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';
import { addressBucketOf } from '@kuraykaraaslan-labs/ip_subnet/server/ip_subnet.ip';
import { ACCESS_TOKEN_PREFIX } from './mcp_oauth.crypto';

export const DECOY_TOKEN_PURPOSE = 'mcp_server.decoy_token';
export const DECOY_TOKEN_SIGNAL = 'mcp_server.decoy_token_touched';
const IPV4_OR_6 = /^[0-9a-f.:]{2,45}$/i;

/** The workspace's decoy token, or null when the server has no decoy key configured. */
export function decoyTokenFor(tenantId: string): string | null {
  const mac = decoyMac(DECOY_TOKEN_PURPOSE, tenantId.toLowerCase());
  return mac ? `${ACCESS_TOKEN_PREFIX}${mac.subarray(0, 32).toString('base64url')}` : null;
}

export function isDecoyAccessToken(raw: string, tenantId: string): boolean {
  const decoy = decoyTokenFor(tenantId);
  if (!decoy || decoy.length !== raw.length) return false;
  return timingSafeEqual(Buffer.from(decoy), Buffer.from(raw));
}

/** One critical signal for the workspace whose decoy was presented. Never throws, never awaited. */
export function noteDecoyTokenTouch(tenantId: string, ip: string | null): void {
  try {
    const actor: ActorRef = ip && IPV4_OR_6.test(ip) ? { kind: 'ip', id: addressBucketOf(ip) } : { kind: 'anon', id: 'anonymous' };
    emitHoneytokenTouch({ kind: DECOY_TOKEN_SIGNAL, source: 'mcp_server', tenantId, actor, lane: 'public-anon' });
  } catch { /* FWA-7: never fail the answer */ }
}
