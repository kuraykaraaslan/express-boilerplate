import { createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';
import { canaryRecordId, decoyMac, noteCanaryRecordTouch, type CanaryCaller } from '@kuraykaraaslan-labs/common/server/common.firewall-decoys';
import { emitHoneytokenTouch, type ActorRef } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';
import { addressBucketOf } from '@kuraykaraaslan-labs/ip_subnet/server/ip_subnet.ip';
import type { ApiKeyEnv } from './api_key.enums';

/**
 * api_key's decoys for the AI firewall (docs/phases/55-ai-firewall/02 §2.5, contributed through `ai_firewall:honeytoken` in
 * api_key.firewall-honeytokens.ts).
 *
 * 1. **The decoy key**: one per tenant, shaped exactly like a real key (`sk_<env>_<tenant prefix>_<48 hex>`), listed only in the
 *    firewall's canary list. It is no row of `api_keys`: no key list, export, quota or count ever sees it, and it can authenticate
 *    nothing (`verify` refuses it on the unknown-key path, with the unknown key's audit row and 401, and refuses it again even if a row
 *    with its hash existed). Its 48 hex characters are the tenant id encrypted under a key derived from the server's field key (32 hex,
 *    AES-128 of one block) and an HMAC tag over the rest (16 hex): `decoyTenantOf` recognises a decoy and its tenant without a lookup,
 *    nobody without the server's secret can mint one, and one tenant's decoy says nothing about another's (common.firewall-decoys.ts).
 *    The check runs for EVERY presented key of that shape (a real one, a wrong one, a decoy), so a decoy costs what a wrong key costs.
 * 2. **The decoy record**: one canary key id per tenant (`canaryRecordId('api_key.decoy_record', tenant)`): no row has it and no page
 *    lists it, so only a caller walking ids, or bait the administrator placed, ever asks `/api/api-keys/<id>` for it. The route answers
 *    what it answers for any missing key (404), and the touch is a critical signal about the signed-in caller.
 *
 * A touch is reported through `emitHoneytokenTouch` (synchronous, bounded, never throws: FWA-7).
 */

export const DECOY_KEY_PURPOSE = 'api_key.decoy_key';
export const DECOY_RECORD_PURPOSE = 'api_key.decoy_record';
export const DECOY_KEY_SIGNAL = 'api_key.decoy_touched';
export const DECOY_RECORD_SIGNAL = 'api_key.decoy_record_touched';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A presented key of the generated shape (api_key.crypto.ts generateRawKey). */
const KEY_SHAPE = /^sk_(live|test)_([0-9a-f]{8})_([0-9a-f]{48})$/;

const tenantPrefix = (tenantId: string): string => tenantId.replace(/-/g, '').slice(0, 8);

/** The block cipher key of the decoy key's tenant field (16 bytes), or null without a field key. */
function blockKey(): Buffer | null {
  const mac = decoyMac(DECOY_KEY_PURPOSE, 'block-key');
  return mac ? mac.subarray(0, 16) : null;
}

/** The HMAC tag of a decoy key (8 bytes), over its environment, prefix and encrypted tenant. */
function tagOf(env: string, prefix: string, cipherHex: string): Buffer | null {
  const mac = decoyMac(DECOY_KEY_PURPOSE, `tag:${env}:${prefix}:${cipherHex}`);
  return mac ? mac.subarray(0, 8) : null;
}

/** One AES-128 block (16 bytes in, 16 out; no padding, no IV: a single block of a unique value). */
function block(key: Buffer, data: Buffer, encrypt: boolean): Buffer {
  if (encrypt) {
    const c = createCipheriv('aes-128-ecb', key, null);
    c.setAutoPadding(false);
    return Buffer.concat([c.update(data), c.final()]);
  }
  const d = createDecipheriv('aes-128-ecb', key, null);
  d.setAutoPadding(false);
  return Buffer.concat([d.update(data), d.final()]);
}

/** The tenant's decoy key, or null (no field key, or the tenant id is not a uuid). Never stored: derived again when the canary list shows it. */
export function decoyKeyFor(tenantId: string, env: ApiKeyEnv): string | null {
  const tenant = tenantId.toLowerCase();
  if (!UUID_RE.test(tenant)) return null;
  const key = blockKey();
  if (!key) return null;
  const cipherHex = block(key, Buffer.from(tenant.replace(/-/g, ''), 'hex'), true).toString('hex');
  const prefix = tenantPrefix(tenant);
  const tag = tagOf(env, prefix, cipherHex);
  return tag ? `sk_${env}_${prefix}_${cipherHex}${tag.toString('hex')}` : null;
}

/**
 * The tenant whose decoy `rawKey` is, or null: not a key of the generated shape, no field key, a tag that does not match (every real and
 * every wrong key). The tag is compared in constant time and the tenant field decrypted whatever the tag said, so the answer costs the
 * same for a decoy and a wrong key of the same shape. Never throws.
 */
export function decoyTenantOf(rawKey: string): string | null {
  try {
    const m = KEY_SHAPE.exec(rawKey);
    if (!m) return null;
    const [, env, prefix, secret] = m;
    const key = blockKey();
    if (!key) return null;
    const cipherHex = secret.slice(0, 32);
    const expected = tagOf(env, prefix, cipherHex);
    if (!expected) return null;
    const tagMatches = timingSafeEqual(expected, Buffer.from(secret.slice(32), 'hex'));
    const hex = block(key, Buffer.from(cipherHex, 'hex'), false).toString('hex');
    const tenant = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
    return tagMatches && hex.startsWith(prefix) ? tenant : null;
  } catch {
    return null;
  }
}

/** The decoy key as the canary list names it: the prefix and the last four characters. */
export function maskDecoyKey(rawKey: string): string {
  const m = KEY_SHAPE.exec(rawKey);
  return m ? `sk_${m[1]}_${m[2]}_…${m[3].slice(-4)}` : '…';
}

/** The tenant's canary key id (the decoy record), or null without a field key. */
export function decoyRecordIdFor(tenantId: string): string | null {
  return canaryRecordId(DECOY_RECORD_PURPOSE, tenantId.toLowerCase());
}

const IPV4_OR_6 = /^[0-9a-fA-F:.]{2,45}$/;

/**
 * A presented decoy key: one critical signal for the decoy's tenant. The caller is anonymous public traffic (the decoy is no credential,
 * so the machine lane its header claimed does not hold: 38 L-2, as `signInLane` reads a forged key), keyed on its address when there is
 * one. `addressedTenantId` is the tenant the request was addressed to, when the verifier knows it (a decoy of one workspace tried on
 * another says the key travelled).
 */
export function noteDecoyKeyTouch(decoyTenantId: string, rawKey: string, ip: string | null, addressedTenantId?: string, requiredScope?: string): void {
  // an address is its rate-limit bucket (an IPv6 /64), as every producer keys one (D55-67)
  const actor: ActorRef = ip && IPV4_OR_6.test(ip) ? { kind: 'ip', id: addressBucketOf(ip) } : { kind: 'anon', id: 'anonymous' };
  emitHoneytokenTouch({
    kind: DECOY_KEY_SIGNAL,
    source: 'api_key',
    tenantId: decoyTenantId,
    actor,
    lane: 'public-anon',
    attrs: {
      keyEnv: rawKey.startsWith('sk_live_') ? 'live' : 'test',
      addressedOwnTenant: addressedTenantId ? addressedTenantId.toLowerCase() === decoyTenantId : null,
      scopeAsked: requiredScope ?? null,
    },
  });
}

/**
 * `/api/api-keys/<id>` asked for the tenant's canary key id: one critical signal about the signed-in caller (its key when it called with
 * one, else the person). The route then answers as for any missing key. A no-op for every other id. Never throws.
 */
export function noteDecoyRecordTouch(
  request: { method?: string; headers: { get(name: string): string | null } },
  tenantId: string,
  apiKeyId: string,
  caller: CanaryCaller | null | undefined,
): boolean {
  return noteCanaryRecordTouch({
    purpose: DECOY_RECORD_PURPOSE, kind: DECOY_RECORD_SIGNAL, source: 'api_key', subjectType: 'ApiKey', request, tenantId, id: apiKeyId, caller,
  });
}
