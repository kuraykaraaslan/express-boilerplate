import 'reflect-metadata'
import { In } from 'typeorm'
import { withSystemRLS } from '@kuraykaraaslan-labs/db'
import { Tenant } from './entities/tenant.entity'

/**
 * Every ACTIVE tenant, for a background sweep that works tenant by tenant
 * (expiry jobs, reminders, retention, usage flushes, billing runs).
 *
 * ## Why this is on the SYSTEM DataSource
 *
 * Migration 123 puts a row-level-security policy on `tenants` itself
 * (`tenantId = app.current_tenant`). A sweep runs with NO tenant in context —
 * that is what makes it a sweep — so on the day the app connects as
 * `app_runtime` (docs/phases/10-db Faz 4), `getDataSource().getRepository(Tenant).find()`
 * silently returns ZERO rows and every scheduled job becomes a no-op without a
 * single error. The system DataSource is the connection `withSystemRLS` uses
 * for exactly this kind of cross-tenant work; until an admin/unpooled URL is
 * configured it IS the default connection, so today nothing changes.
 *
 * This is the one place a sweep asks "which tenants?". The per-tenant work
 * that follows still goes through `withTenantRepositoryFor(tenantId, …)`.
 */
export async function listActiveTenants(): Promise<Tenant[]> {
  // Through `withSystemRLS`, which runs on that same system connection AND
  // sets `app.bypass_rls` for the transaction: migration 122 made bypass need
  // both the admin identity and the GUC, so a bare system-connection read would
  // still have seen zero rows after the cutover.
  return withSystemRLS((qr) => qr.manager.getRepository(Tenant).find({ where: { tenantStatus: 'ACTIVE' } }))
}

/**
 * The id of every tenant that is not deleted, whatever its status (system RLS, like `listActiveTenants`). For a sweep that must not
 * skip a tenant whose rows can still be served or read, e.g. the CMS page flag rebuild (dynamic_page.flags.rebuild.ts, D251): a page
 * flag left unbuilt for a suspended tenant that is reinstated would be a page the CDN may cache for everybody. Ids only.
 */
export async function listLiveTenantIds(): Promise<string[]> {
  const rows = await withSystemRLS((qr) => qr.manager.getRepository(Tenant).find({ select: { tenantId: true } }))
  return rows.map((r) => r.tenantId)
}

/**
 * The statuses a retention sweep leaves alone: a tenant frozen for a migration (MIGRATING, its bundle must match what was exported), one still
 * arriving (IMPORTING) and the tombstone of one that moved away (RELOCATED, its data lives on another node). Every other status is swept: personal
 * data does not get to outlive its retention because the workspace is suspended, archived or awaiting deletion.
 */
export const RETENTION_SKIPPED_STATUSES: readonly string[] = Object.freeze(['MIGRATING', 'IMPORTING', 'RELOCATED'])

/**
 * Whether a retention sweep may delete or anonymise this tenant's rows now (pure). A tenant under a legal hold is skipped as a whole
 * (docs/phases/02-fleet/06 "purge and retention sweepers skip held rows", decision F19): a hold freezes what exists, and the next run after the hold
 * ends catches up, since every retention sweep selects by age, not by "new since the last run".
 */
export function retentionEligible(t: { tenantStatus: string; legalHoldUntil?: Date | null }, now: Date): boolean {
  if (RETENTION_SKIPPED_STATUSES.includes(t.tenantStatus)) return false
  return !(t.legalHoldUntil && t.legalHoldUntil.getTime() > now.getTime())
}

const RETENTION_FIELDS = { tenantId: true, tenantStatus: true, legalHoldUntil: true } as const

/**
 * The tenants a retention sweep works on (system RLS, like `listActiveTenants`): every tenant `retentionEligible` admits, soft-deleted ones
 * included. A deleted workspace (`TenantWriteService.remove` only stamps `deletedAt`) still holds its rows until the purge, and their retention
 * runs on until then; the status and legal-hold rules apply to it exactly as to a live one.
 */
export async function listRetentionTenants(now: Date = new Date()): Promise<Tenant[]> {
  const all = await withSystemRLS((qr) => qr.manager.getRepository(Tenant).find({ select: RETENTION_FIELDS, withDeleted: true }))
  return all.filter((t) => retentionEligible(t, now))
}

/**
 * Whether one tenant may be swept NOW (system RLS, soft-deleted included): re-read right before its work, so a legal hold placed or a migration
 * started after the run listed its tenants is honoured for every tenant not yet reached. A tenant whose row is gone (purged meanwhile) is not.
 */
export async function isRetentionEligibleNow(tenantId: string, now: Date = new Date()): Promise<boolean> {
  const t = await withSystemRLS((qr) => qr.manager.getRepository(Tenant).findOne({ where: { tenantId }, select: RETENTION_FIELDS, withDeleted: true }))
  return t ? retentionEligible(t, now) : false
}

/**
 * Which of these tenant ids exist (system RLS, soft-deleted included: a deleted workspace keeps its rows, and their retention, until the
 * purge). One query, ids only. For a store that must not keep rows under a tenant that does not exist (the AI firewall's signal consumer,
 * docs/phases/55-ai-firewall D55-71). Lower case.
 */
export async function existingTenantIds(tenantIds: readonly string[]): Promise<Set<string>> {
  if (tenantIds.length === 0) return new Set()
  const rows = await withSystemRLS((qr) => qr.manager.getRepository(Tenant).find({
    select: { tenantId: true }, where: { tenantId: In([...tenantIds]) }, withDeleted: true,
  }))
  return new Set(rows.map((r) => String(r.tenantId).toLowerCase()))
}
