import { createPrivateKey, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import { canonicalize } from './canonical';
import { importSealPublicKey, openSealedString, seal } from './seal';

/**
 * The tenant's NAMES as a migration's target checks them BEFORE the source freezes (docs/phases/02-fleet/05 section 6.2 NAMES, P6-MIGRATION-BUNDLE).
 *
 * The slug and the custom domains are what a moving tenant can collide on at its new home (per-region slug namespace, globally unique domains, a slug the
 * target retired). Decision 9 forbids the control plane any global name map, even keyed hashes, so the names never reach it in a form it can read: the
 * SOURCE seals them to the target's ATTESTED ephemeral X25519 key (the key of the preflight's attestation, which the source verified against the contract's
 * co-signed fingerprint), the control plane relays the opaque box, and the TARGET opens it with the private half only it holds for this migration and
 * refuses a name it cannot take. The box is bound to the migration (`migrationId`, `tenantId` inside), and the key is per migration and forgotten at the
 * cutover or the abort, so a box opens nowhere else and for nothing else.
 *
 * What it is NOT: an authority. Anyone may seal to a public key, so a relay that substitutes a box can make the early check pass (or fail); the import's
 * own refusals (the unique slug and domain indexes, the slug tombstones, 05 section 6.4) stay the authority. The early check exists so that a collision
 * is refused while the tenant is still writable, not after it has been frozen read-only for an export that can never import.
 */
export const MIGRATION_NAMES_VERSION = 1;
/** The most custom domains a box carries (a plan's domain cap is single digits; a tenant past this is refused by the names step, never truncated). */
export const MAX_MIGRATION_DOMAINS = 128;
/**
 * The longest sealed box a step result or payload carries: 128 ASCII domains of 255 characters, sealed and base64url-encoded, fit with room. A tenant
 * whose names do not fit (non-ASCII names near the length limits) is refused by the source's seal (`UNSEALABLE_NAMES`), never truncated.
 */
export const MAX_SEALED_NAMES_CHARS = 64 * 1024;

/**
 * The names are carried as the columns can hold them, not narrowed to today's creation rules: neither `tenants.slug` (varchar 63) nor
 * `tenant_domains.domain` is shape-checked on write (the DTO only bounds the domain to 255 characters; a legacy slug may hold a space, a domain a port,
 * a `*` or an IDN that is not punycode). A narrower rule here would refuse such a tenant on every retry of the seal and keep its migration in PREFLIGHT,
 * while the import (which has no shape check) would take it. Only control characters are refused, and a stored name that still fails this (or a set
 * of names whose box would exceed `MAX_SEALED_NAMES_CHARS`) is a definitive `UNSEALABLE_NAMES` at the source, so the migration aborts.
 */
const NO_CONTROL = /^[^\u0000-\u001f\u007f]+$/;
const slug = z.string().min(1).max(63).regex(NO_CONTROL);
const domain = z.string().min(1).max(255).regex(NO_CONTROL);

export const MigrationNamesSchema = z.object({
  v: z.literal(MIGRATION_NAMES_VERSION),
  migrationId: z.uuid(),
  tenantId: z.uuid(),
  /** The tenant's slug, or null when it has none. */
  slug: slug.nullable(),
  /** Every custom domain the tenant holds, each once, in ascending order. */
  domains: z.array(domain).max(MAX_MIGRATION_DOMAINS)
    .refine((d) => d.every((x, i) => i === 0 || d[i - 1]! < x), 'domains must be distinct and in ascending order'),
}).strict();
export type MigrationNames = z.infer<typeof MigrationNamesSchema>;

/** The sealed box as steps carry it: base64url, at most `MAX_SEALED_NAMES_CHARS`. */
export const SealedNamesSchema = z.string().min(1).max(MAX_SEALED_NAMES_CHARS).regex(/^[A-Za-z0-9_-]+$/);

/** The names in the form the box holds: domains de-duplicated and sorted. Throws on anything the schema refuses (too many domains, a bad name). */
export function migrationNamesOf(i: { migrationId: string; tenantId: string; slug: string | null; domains: readonly string[] }): MigrationNames {
  const domains = [...new Set(i.domains)].sort();
  return MigrationNamesSchema.parse({ v: MIGRATION_NAMES_VERSION, migrationId: i.migrationId, tenantId: i.tenantId, slug: i.slug, domains });
}

/** Seals the names to the attested ephemeral key (raw X25519, base64url, as the attestation carries it). Throws on invalid names or key. */
export function sealMigrationNames(names: MigrationNames, ephemeralPub: string): string {
  const parsed = MigrationNamesSchema.parse(names);
  const box = seal(canonicalize(parsed), importSealPublicKey(ephemeralPub));
  if (box.length > MAX_SEALED_NAMES_CHARS) throw new Error('sealed migration names exceed the carried size');
  return box;
}

export type OpenNamesVerdict = { ok: true; names: MigrationNames } | { ok: false; reason: 'BAD_SHAPE' | 'DOES_NOT_OPEN' | 'WRONG_CONTRACT' };

/**
 * Opens a box with the migration's ephemeral private key and checks that it names exactly this migration and tenant. A box that does not open, opens to
 * anything but this exact shape, or names another migration is refused: the target never judges names it cannot attribute.
 */
export function openMigrationNames(sealed: unknown, privateKey: KeyObject | string, expect: { migrationId: string; tenantId: string }): OpenNamesVerdict {
  const s = SealedNamesSchema.safeParse(sealed);
  if (!s.success) return { ok: false, reason: 'BAD_SHAPE' };
  let key: KeyObject;
  try { key = typeof privateKey === 'string' ? createPrivateKey(privateKey) : privateKey; } catch { return { ok: false, reason: 'DOES_NOT_OPEN' }; }
  const text = openSealedString(s.data, key);
  if (text === null) return { ok: false, reason: 'DOES_NOT_OPEN' };
  let parsed: ReturnType<typeof MigrationNamesSchema.safeParse>;
  try { parsed = MigrationNamesSchema.safeParse(JSON.parse(text)); } catch { return { ok: false, reason: 'BAD_SHAPE' }; }
  if (!parsed.success) return { ok: false, reason: 'BAD_SHAPE' };
  if (parsed.data.migrationId !== expect.migrationId || parsed.data.tenantId !== expect.tenantId) return { ok: false, reason: 'WRONG_CONTRACT' };
  return { ok: true, names: parsed.data };
}

/**
 * The refusals of the target's names check, each a name the tenant could not take there: its slug held by another tenant (any status, soft-deleted ones
 * included: the unique index covers them), its slug retired by a purge here (`tenant_slug_tombstones`), a domain held by another tenant. A refusal no
 * retry changes while the names stay as they are, so the directory aborts the migration (the source was never frozen).
 */
export const MIGRATION_NAME_REFUSALS = ['SLUG_TAKEN', 'SLUG_TOMBSTONED', 'DOMAIN_TAKEN'] as const;
export type MigrationNameRefusal = (typeof MIGRATION_NAME_REFUSALS)[number];
