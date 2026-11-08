import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Key wrapping under a 32-byte key-encryption key (the region KEK of docs/phases/02-fleet/04 section 3, or a key derived from it). Shared by the
 * fleet agent's private-key files (`fleet_agent/server/agent.kek.ts`, prefix `fleetkek1`) and the tenant key store of the db module
 * (`db.key-provider.ts`). AES-256-GCM with the slot `label` bound as additional data, so a wrapped blob cannot be swapped between slots.
 * Format: `<prefix>.<iv>.<ciphertext>.<tag>` (base64url). Pure `node:crypto`; `common` stays a dependency-free leaf.
 */

/**
 * Parses a KEK from file contents: 32 raw bytes, or 64 hex chars (surrounding whitespace ignored).
 * The KEK itself comes from the regional KMS/age host (04 section 3); this module only consumes 32 bytes.
 */
export function parseKek(contents: Buffer): Buffer {
  if (contents.length === 32) return Buffer.from(contents);
  const text = contents.toString('utf8').trim();
  if (/^[0-9a-fA-F]{64}$/.test(text)) return Buffer.from(text, 'hex');
  throw new Error('KEK must be 32 raw bytes or 64 hex characters');
}

/** Wraps `data` under `kek`, bound to `label`. */
export function wrapUnderKek(prefix: string, kek: Buffer, label: string, data: Buffer): string {
  if (kek.length !== 32) throw new Error('KEK must be 32 bytes');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', kek, iv);
  c.setAAD(Buffer.from(label));
  const ct = Buffer.concat([c.update(data), c.final()]);
  return [prefix, iv.toString('base64url'), ct.toString('base64url'), c.getAuthTag().toString('base64url')].join('.');
}

/** Inverse of wrapUnderKek; throws on a wrong KEK, wrong label, tampering or a malformed blob (never says which). */
export function unwrapUnderKek(prefix: string, kek: Buffer, label: string, wrapped: string): Buffer {
  if (kek.length !== 32) throw new Error('KEK must be 32 bytes');
  const parts = wrapped.trim().split('.');
  if (parts.length !== 4 || parts[0] !== prefix) throw new Error('malformed wrapped key');
  const [, iv, ct, tag] = parts.map((p, i) => (i === 0 ? Buffer.alloc(0) : Buffer.from(p, 'base64url')));
  if (iv.length !== 12 || tag.length !== 16) throw new Error('malformed wrapped key');
  const d = createDecipheriv('aes-256-gcm', kek, iv);
  d.setAAD(Buffer.from(label));
  d.setAuthTag(tag);
  try {
    return Buffer.concat([d.update(ct), d.final()]);
  } catch {
    throw new Error('unwrap failed (wrong KEK, wrong key slot, or tampered data)');
  }
}
