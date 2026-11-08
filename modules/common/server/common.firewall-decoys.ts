import { createHmac } from 'node:crypto';
import { deriveNodeFieldSubkey } from './field-encryption';
import { emitHoneytokenTouch, type ActorRef } from './common.firewall-contracts';
import { isLane, LANE_HEADER } from './lane';

/**
 * Keyed values for the firewall's decoys (docs/phases/55-ai-firewall/02 §2.5), server only.
 *
 * A decoy (a canary record id, the decoy API key) must be stable per tenant, recognisable by the module that owns it in microseconds and
 * without a lookup, and impossible to forge or predict for anyone who does not hold the server's secret: an intruder who saw one tenant's
 * canary learns nothing about another's, and nobody can mint a value the platform would take for a decoy. So every value here is an HMAC
 * under a purpose-bound subkey of this node's field key (`deriveNodeFieldSubkey('firewall.decoy.v1')`, HKDF-SHA256 of
 * SETTINGS_ENCRYPTION_KEY, which production requires), never a bare hash of the tenant id. Nothing is stored: the owning module derives the
 * value again when it plants it (the canary list) and when it checks a request.
 *
 * Without a field key (a development install without SETTINGS_ENCRYPTION_KEY) there are no decoys: every function answers null and the
 * owning modules behave exactly as before (FWA-7). A rotation of the field key changes every decoy; bait planted before it is no longer
 * recognised (the canary list shows the new values).
 */

const SUBKEY_PURPOSE = 'firewall.decoy.v1';
/** Derived values one process remembers (per tenant and purpose); past it the memory starts again. */
const MEMO_MAX = 10_000;

const PURPOSE_RE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_.:-]{0,63}$/;

interface DecoyKeyState {
  /** undefined = not derived yet; null = no field key. */
  subkey: Buffer | null | undefined;
  memo: Map<string, string>;
}
const STATE_KEY = Symbol.for('kuraykaraaslan-labs.common.firewallDecoyKeys');
const holder = globalThis as unknown as Record<symbol, DecoyKeyState | undefined>;
const state = (): DecoyKeyState => (holder[STATE_KEY] ??= { subkey: undefined, memo: new Map() });

function subkey(): Buffer | null {
  const s = state();
  if (s.subkey === undefined) {
    try { s.subkey = deriveNodeFieldSubkey(SUBKEY_PURPOSE); } catch { s.subkey = null; }
  }
  return s.subkey;
}

/** Whether this process can derive decoys (it holds a field key). */
export function decoysAvailable(): boolean {
  return subkey() !== null;
}

/**
 * HMAC-SHA256 of `value` under the decoy subkey, bound to `purpose` (`<module>.<decoy>`, e.g. `tenant_member.decoy_record`): the raw
 * bytes, or null without a field key or with a malformed purpose.
 */
export function decoyMac(purpose: string, value: string): Buffer | null {
  if (!PURPOSE_RE.test(purpose)) return null;
  const key = subkey();
  if (!key) return null;
  return createHmac('sha256', key).update(purpose, 'utf8').update('\u0000').update(value, 'utf8').digest();
}

/** 16 bytes as a version 4 uuid string (the version and variant bits set), so a canary id looks like every other id of the table. */
export function bytesToUuidV4(bytes: Buffer): string {
  const b = Buffer.from(bytes.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * The tenant's canary record id for one purpose: a well-formed uuid no row has, the same on every node that holds the field key, derived
 * once per process and tenant. null without a field key. The owning module compares a requested id with it (lower case).
 */
export function canaryRecordId(purpose: string, tenantId: string): string | null {
  const memoKey = `${purpose}\u0000${tenantId}`;
  const s = state();
  const hit = s.memo.get(memoKey);
  if (hit) return hit;
  const mac = decoyMac(purpose, tenantId.toLowerCase());
  if (!mac) return null;
  const id = bytesToUuidV4(mac);
  if (s.memo.size >= MEMO_MAX) s.memo.clear();
  s.memo.set(memoKey, id);
  return id;
}

/** Whether `id` is the tenant's canary record id for `purpose`. False without a field key, for a missing id or tenant. Never throws. */
export function isCanaryRecordId(purpose: string, tenantId: string | null | undefined, id: string | null | undefined): boolean {
  try {
    if (!tenantId || typeof id !== 'string' || id.length !== 36) return false;
    const canary = canaryRecordId(purpose, tenantId);
    return canary !== null && canary === id.toLowerCase();
  } catch {
    return false;
  }
}

/** What a record route knows of its caller after the guard (the parts of TenantAuthResult a touch names). */
export interface CanaryCaller {
  user?: { userId: string } | null;
  apiKey?: { apiKeyId: string } | null;
}

export interface CanaryRecordTouch {
  /** The canary's purpose (`<module>.<decoy>`, as `canaryRecordId` was asked). */
  purpose: string;
  /** The detector's signal kind. */
  kind: string;
  /** The owning module. */
  source: string;
  /** The subject type of the record (`ApiKey`, `TenantMember`). */
  subjectType: string;
  request: { method?: string; headers: { get(name: string): string | null } };
  tenantId: string;
  /** The id the request asked for. */
  id: string;
  caller?: CanaryCaller | null;
}

/**
 * A record route asked for the tenant's canary id: one critical signal about the caller after its guard passed (its key when it called
 * with one, else the person; the lane is the proxy's stamp). The route then answers what it answers for any missing record. A no-op for
 * every other id, and without a field key. Synchronous, never throws (FWA-7). Answers whether it was the canary.
 */
export function noteCanaryRecordTouch(t: CanaryRecordTouch): boolean {
  try {
    const tenantId = t.tenantId.toLowerCase();
    if (!isCanaryRecordId(t.purpose, tenantId, t.id)) return false;
    const actor: ActorRef = t.caller?.apiKey?.apiKeyId
      ? { kind: 'apiKey', id: t.caller.apiKey.apiKeyId }
      : t.caller?.user?.userId ? { kind: 'user', id: t.caller.user.userId } : { kind: 'anon', id: 'anonymous' };
    const stamp = t.request.headers.get(LANE_HEADER)?.trim();
    emitHoneytokenTouch({
      kind: t.kind,
      source: t.source,
      tenantId,
      actor,
      subject: { type: t.subjectType, id: t.id.toLowerCase() },
      lane: isLane(stamp) ? stamp : 'unknown',
      attrs: { method: typeof t.request.method === 'string' ? t.request.method.toUpperCase().slice(0, 8) : null },
    });
    return true;
  } catch {
    return false;
  }
}

/** Test seam: forget the derived subkey and the memo (a test that configures another field key). */
export function resetFirewallDecoyKeys(): void {
  holder[STATE_KEY] = undefined;
}
