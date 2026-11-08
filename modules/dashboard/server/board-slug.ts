import crypto from 'node:crypto'

const TR_FOLD: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', İ: 'i' }

/** A URL-safe, non-unique base for a minted slug — see `mintSlug`. */
export function slugBase(title: string): string {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/[çğıöşüİ]/g, (ch) => TR_FOLD[ch] ?? ch)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return base || 'board'
}

/**
 * Mint a slug the caller never supplies (Faz 9, K6). Always matches
 * `dashboard.dto.ts`'s `BoardSlugSchema` shape (lowercase alnum/dash,
 * starting alnum) by construction, so nothing downstream needs to re-validate
 * it. `@Unique(['tenantId', 'slug'])` is tenant-wide, so letting a client pick
 * one could 409 on a stranger's private board and confirm to an attacker that
 * it exists; the server owns the value instead. A random suffix rather than a
 * counter, because a counter would need to read every existing slug under the
 * same base first, for a value nothing ever reads back.
 *
 * Pure and deliberately free of service/db imports — `board.crud.service.ts`
 * imports `@kuraykaraaslan-labs/db`, which boots env at import time, so a unit
 * test for this would otherwise need a full DATABASE_URL/token-secret
 * environment for a string transform that touches no row. Same reason
 * `board.acl.ts` and `widget.transitions.ts` are kept separate from theirs.
 */
export function mintSlug(title: string): string {
  return `${slugBase(title)}-${crypto.randomBytes(4).toString('hex')}`
}
