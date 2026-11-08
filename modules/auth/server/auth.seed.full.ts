import 'reflect-metadata'
import type { FindOptionsWhere } from 'typeorm'
import type { SeedContext } from '@kuraykaraaslan-labs/db/server/db.seed-contracts'
import { SEED_USER_ID, SEED_ADMIN_USER_ID } from '@kuraykaraaslan-labs/db/server/db.seed-contracts'
import { UserConsent } from './entities/user_consent.entity'

/** The third seeded demo user (suspended account); the shared constants only export the first two. */
const SEED_SUSPENDED_USER_ID = 'a0000000-0000-4000-8000-000000000003'
/** Subjects that exist in no `users` table: registrations that never produced a login. */
const syntheticUserId = (n: number) => `c0000000-0000-4000-8000-${String(0xa000 + n).padStart(12, '0')}`

/** Every row carries this in `userAgent`, so a report can filter the whole lane out. */
export const SYNTHETIC_CONSENT_MARKER = 'seed-synthetic/full-load (fabricated consent, not evidence of any act)'
/** RFC 5737 TEST-NET-1: documentation addresses that never route to a real client. */
const TEST_NET_IP = (n: number) => `192.0.2.${n}`

/** Fixed anchor so the rows (and their order in the ledger) never depend on the clock. */
const ANCHOR = Date.UTC(2026, 5, 1, 9, 0, 0)
const DAY = 24 * 60 * 60 * 1000
const at = (daysBeforeAnchor: number) => new Date(ANCHOR - daysBeforeAnchor * DAY)

/**
 * Full-load seed for `auth`: the registration-time consent ledger (`user_consents`).
 *
 * Why this is NOT in the default seed (`auth` is in the exemption registry as
 * `legal-evidence`): a consent row is evidence that a person agreed to a specific
 * document version at a moment in time. Fabricated rows in a demo or production-like
 * tenant would be false evidence, so the default lane never writes them. The
 * full-load lane exists so that every table in the guarded test database has rows
 * (RLS, export, join and list-screen tests need data), and it only runs against a
 * database whose name ends in "test".
 *
 * Every row is marked synthetic: `userAgent` starts with {@link SYNTHETIC_CONSENT_MARKER}
 * (the entity has no source/metadata column), and `ipAddress` is on the RFC 5737
 * documentation range. Nothing here is read by any flow: `user_consents` is written only
 * by the consent sink and read by nothing else, so login and registration are untouched.
 *
 * Coverage:
 *  - the three seeded demo users, a re-consent after a document version bump (same user,
 *    same document, newer version), and several document types;
 *  - a tenant-less row (self-registration before any tenant context exists) and a row
 *    with no locale/ip, since all three of those columns are nullable;
 *  - subjects that exist nowhere (`c0000000-0000-4000-8000-…`, a reserved synthetic family), plus `ctx.count(3)` filler rows.
 *
 * Idempotent: keyed on `(userId, documentType, documentVersion)`; dates are fixed.
 */
export async function seedAuthFull(ctx: SeedContext): Promise<void> {
  const { tenantId, foc } = ctx
  const refs = ctx.refs
  const userId = typeof refs.userId === 'string' ? refs.userId : SEED_USER_ID
  const adminUserId = typeof refs.adminUserId === 'string' ? refs.adminUserId : SEED_ADMIN_USER_ID

  type Def = {
    userId: string
    tenantId: string | null
    documentType: string
    documentVersion: string
    locale: string | null
    ipAddress: string | null
    createdAt: Date
  }

  const defs: Def[] = [
    // demo.user: the first terms + privacy consent, then a re-consent after the terms were revised.
    { userId, tenantId, documentType: 'terms_of_service', documentVersion: '2025-01-01', locale: 'en', ipAddress: TEST_NET_IP(11), createdAt: at(300) },
    { userId, tenantId, documentType: 'privacy_policy', documentVersion: '2025-01-01', locale: 'en', ipAddress: TEST_NET_IP(11), createdAt: at(300) },
    { userId, tenantId, documentType: 'terms_of_service', documentVersion: '2026-01-01', locale: 'en', ipAddress: TEST_NET_IP(12), createdAt: at(120) },
    { userId, tenantId, documentType: 'cookie_policy', documentVersion: 'v3', locale: 'en', ipAddress: TEST_NET_IP(12), createdAt: at(119) },
    // demo.admin: both documents, in the tenant's other language.
    { userId: adminUserId, tenantId, documentType: 'terms_of_service', documentVersion: '2025-01-01', locale: 'tr', ipAddress: TEST_NET_IP(21), createdAt: at(280) },
    { userId: adminUserId, tenantId, documentType: 'privacy_policy', documentVersion: '2025-01-01', locale: 'tr', ipAddress: TEST_NET_IP(21), createdAt: at(280) },
    // demo.suspended: consented once, never again.
    { userId: SEED_SUSPENDED_USER_ID, tenantId, documentType: 'terms_of_service', documentVersion: '2025-01-01', locale: 'en', ipAddress: TEST_NET_IP(31), createdAt: at(200) },
    // Tenant-less: self-registration happens before a tenant context is resolved.
    { userId: syntheticUserId(1), tenantId: null, documentType: 'terms_of_service', documentVersion: 'v3', locale: 'de', ipAddress: TEST_NET_IP(41), createdAt: at(90) },
    // Everything optional left empty.
    { userId: syntheticUserId(2), tenantId: null, documentType: 'privacy_policy', documentVersion: 'v3', locale: null, ipAddress: null, createdAt: at(60) },
  ]

  const fillers = ctx.count(3)
  for (let i = 1; i <= fillers; i++) {
    defs.push({
      userId: syntheticUserId(100 + i),
      tenantId,
      documentType: i % 2 ? 'terms_of_service' : 'privacy_policy',
      documentVersion: `2026-0${(i % 9) + 1}-01`,
      locale: i % 2 ? 'en' : 'tr',
      ipAddress: TEST_NET_IP(100 + (i % 100)),
      createdAt: at(30 + i),
    })
  }

  const repo = ctx.repo<UserConsent>(UserConsent)
  for (const def of defs) {
    await foc(
      repo,
      { userId: def.userId, documentType: def.documentType, documentVersion: def.documentVersion } as FindOptionsWhere<UserConsent>,
      { ...def, userAgent: `${SYNTHETIC_CONSENT_MARKER} #${def.documentType}` },
    )
  }

  ctx.log(`auth(full): ${defs.length} synthetic consent records for ${tenantId}`)
}
