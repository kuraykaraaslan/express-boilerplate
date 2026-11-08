import Logger from '@kuraykaraaslan-labs/logger'
import { UploadResult } from './storage.types'
import { TenantUsageService } from '@kuraykaraaslan-labs/tenant_usage/server/tenant_usage.service'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import { UploadedFile } from './entities/uploaded_file.entity'
import FeatureGateService from '@kuraykaraaslan-labs/feature_gate/server/feature_gate.service'
import { FEATURE_KEYS } from '@kuraykaraaslan-labs/feature_gate/server/feature_gate.keys'
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants'
import { isPlatformServed } from '@kuraykaraaslan-labs/common/server/external-extensions'
import UserAgentService from '@kuraykaraaslan-labs/common/server/user_agent/user_agent.service'
import type { VirusScanStatus } from './storage.scan.enums'
import type { ScanResult } from './storage.scan.types'
import type { UploadOrigin } from './storage.dto'

/** The longest an upload waits on the geo lookup for its audit row's country. */
export const UPLOAD_GEO_WAIT_MS = 1_500

/** The host point of storage providers (storage.provider-factory.ts), whose setting level decides who pays (phase 53.5). */
const STORAGE_PROVIDER_POINT = 'storage:provider'

/**
 * Persist an UploadedFile audit row + increment the tenant_usage.storageBytes
 * counter. Best-effort: failures are logged but do not fail the upload —
 * the file is already in the bucket at this point.
 */
export async function persistUploadAudit(
  tenantId: string,
  userId: string | undefined,
  result: UploadResult,
  mimeType: string,
  scanStatus: VirusScanStatus = 'skipped',
  origin?: UploadOrigin,
): Promise<string | undefined> {
  const size = result.size ?? 0
  let uploadedFileId: string | undefined

  // Infer the upload's country from its IP (best-effort; never blocks the audit).
  // The wait is capped: a first-seen IP can mean a slow provider call, and the
  // upload response waits for this row. A lookup that runs over is left to
  // finish in the background (it still fills the per-IP cache); the row simply
  // goes without a country.
  let country: string | undefined
  if (origin?.ip) {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const geo = await Promise.race([
        UserAgentService.getGeoLocation(origin.ip, tenantId),
        new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), UPLOAD_GEO_WAIT_MS) }),
      ])
      country = geo ? geo.countryCode ?? geo.country ?? undefined : undefined
    } catch {
      /* geo lookup is non-critical */
    } finally {
      clearTimeout(timer)
    }
  }

  try {
    const saved = await withTenantRepositoryFor(tenantId, UploadedFile, (repo) => repo.save(repo.create({
      tenantId,
      userId,
      key: result.key,
      bucket: result.bucket,
      provider: result.provider,
      size,
      mimeType: mimeType || 'application/octet-stream',
      url: result.url,
      ...(result.source ? { source: result.source } : {}),
      scanStatus,
      ipAddress: origin?.ip,
      userAgent: origin?.userAgent,
      country,
    })))
    uploadedFileId = saved.uploadedFileId
    // Phase 53.5: the plan's storage counts what the platform's storage holds; the tenant's own bucket is not the plan's.
    if (size > 0 && result.source !== 'tenant') {
      await TenantUsageService.incrementStorageBytes(tenantId, size)
    }
  } catch (error) {
    Logger.warn(
      `StorageService.persistUploadAudit failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  return uploadedFileId
}

/**
 * Update the scan columns of an UploadedFile audit row after an async scan
 * resolves. Best-effort: a failed write is logged, not thrown.
 */
export async function updateScanResult(
  tenantId: string,
  uploadedFileId: string,
  res: ScanResult,
): Promise<void> {
  try {
    await withTenantRepositoryFor(tenantId, UploadedFile, (repo) => repo.update(
      { uploadedFileId, tenantId },
      {
        scanStatus: res.status,
        scanProvider: res.provider,
        scanResult: res.detail ?? res.threat,
        scannedAt: new Date(),
      },
    ))
  } catch (error) {
    Logger.warn(
      `StorageService.updateScanResult failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Defense-in-depth billing gate for uploads. Asserts the tenant's active
 * plan grants `feature_storage_upload` (BOOLEAN) and that the cumulative
 * `feature_storage_quota_bytes` LIMIT (compared against
 * TenantUsage.storageBytes for the current month) is not exhausted.
 *
 * Root tenant is short-circuited. Best-effort — LIMIT check is not atomic
 * and the post-upload bytes counter increment can briefly push usage
 * above the ceiling under concurrent uploads.
 */
export async function assertStorageFeatureAccess(tenantId: string): Promise<void> {
  if (isRootTenant(tenantId)) return

  await FeatureGateService.assertFeatureAccess(tenantId, FEATURE_KEYS.FEATURE_STORAGE_UPLOAD)
  // Phase 53.5: the plan's storage quota bounds the platform's storage; a tenant storing on its own provider is not bound by it.
  if (!(await isPlatformServed(tenantId, STORAGE_PROVIDER_POINT))) return

  const usage = await TenantUsageService.getUsage(tenantId)
  await FeatureGateService.assertFeatureAccess(
    tenantId,
    FEATURE_KEYS.FEATURE_STORAGE_QUOTA_BYTES,
    usage.storageBytes,
  )
}

/**
 * Caller-facing storage quota summary. Reports what the pre-upload gate
 * (`assertStorageFeatureAccess`) checks against — the tenant's used bytes,
 * its plan storage-quota ceiling, and the remaining headroom — but returns
 * the numbers instead of throwing.
 *
 * It resolves the ceiling from the SAME source the gate asserts on: the
 * `feature_storage_quota_bytes` LIMIT feature, read here via the non-throwing
 * `checkFeatureAccess` so an over-quota tenant still gets an accurate report.
 * `quotaBytes` / `remainingBytes` are `-1` when the quota is unlimited (plan
 * LIMIT of -1, or the unbound root tenant); `0` when no quota is granted.
 */
export interface StorageUsageSummary {
  usedBytes: number
  quotaBytes: number
  remainingBytes: number
}

export async function getStorageUsageSummary(tenantId: string): Promise<StorageUsageSummary> {
  const usage = await TenantUsageService.getUsage(tenantId)
  const usedBytes = usage.storageBytes

  // Root tenant is unbound by any plan quota (mirrors assertStorageFeatureAccess), and so is a tenant storing on its own provider
  // (phase 53.5).
  if (isRootTenant(tenantId) || !(await isPlatformServed(tenantId, STORAGE_PROVIDER_POINT))) {
    return { usedBytes, quotaBytes: -1, remainingBytes: -1 }
  }

  const access = await FeatureGateService.checkFeatureAccess(
    tenantId,
    FEATURE_KEYS.FEATURE_STORAGE_QUOTA_BYTES,
    usedBytes,
  )

  // LIMIT feature: `limit` is the quota in bytes (-1 = unlimited). A BOOLEAN
  // result means no quota feature is granted (no/inactive subscription) → 0.
  const quotaBytes = access.type === 'LIMIT' ? access.limit : 0
  const remainingBytes = quotaBytes === -1 ? -1 : Math.max(0, quotaBytes - usedBytes)

  return { usedBytes, quotaBytes, remainingBytes }
}

/** Audit event kinds written by the storage module itself. */
export const STORAGE_AUDIT_EVENTS = {
  LINK_FETCHED: 'storage.link.fetched',
  LINK_CREATED: 'storage.link.created',
  LINK_REVOKED: 'storage.link.revoked',
  BUCKET_CORS_APPLIED: 'storage.bucket_cors.applied',
} as const

/**
 * Best-effort audit row for the machine download links (docs/phases/15-storage/01).
 * Goes to the platform audit log when that module is installed; never throws
 * and never delays the download it describes.
 */
export async function auditStorageLinkEvent(
  tenantId: string,
  action: (typeof STORAGE_AUDIT_EVENTS)[keyof typeof STORAGE_AUDIT_EVENTS],
  linkId: string,
  metadata: Record<string, unknown>,
  origin?: { ip?: string; userAgent?: string },
): Promise<void> {
  try {
    const { default: AuditLogService } = await import('@kuraykaraaslan-labs/audit_log/server/audit_log.service')
    await AuditLogService.log({
      tenantId,
      actorType: 'SYSTEM',
      action,
      resourceType: 'storage_link',
      resourceId: linkId,
      metadata,
      ipAddress: origin?.ip ?? null,
      userAgent: origin?.userAgent ?? null,
    })
  } catch (error) {
    Logger.warn(`storage link audit failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Audit row for an admin applying the direct-upload CORS rule to the tenant's
 * bucket (`storage.bucket-cors.ts`): a configuration change outside the app's
 * own settings rows, recorded like a setting change, with the actor. Best-effort:
 * the bucket was already changed when this runs.
 */
export async function auditBucketCorsApplied(
  tenantId: string,
  actorId: string | undefined,
  bucket: string,
  metadata: Record<string, unknown>,
  origin?: { ip?: string; userAgent?: string },
): Promise<void> {
  try {
    const { default: AuditLogService } = await import('@kuraykaraaslan-labs/audit_log/server/audit_log.service')
    await AuditLogService.log({
      tenantId,
      actorId,
      actorType: actorId ? 'USER' : 'SYSTEM',
      action: STORAGE_AUDIT_EVENTS.BUCKET_CORS_APPLIED,
      resourceType: 'storage_bucket',
      resourceId: bucket,
      metadata,
      ipAddress: origin?.ip ?? null,
      userAgent: origin?.userAgent ?? null,
    })
  } catch (error) {
    Logger.warn(`storage bucket cors audit failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}
