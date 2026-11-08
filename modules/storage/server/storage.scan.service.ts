import Logger from '@kuraykaraaslan-labs/logger'
import { reportRefusal } from '@kuraykaraaslan-labs/common/server/refusal-sink'
import { TenantUsageService } from '@kuraykaraaslan-labs/tenant_usage/server/tenant_usage.service'
import { getProvider } from './storage.provider-factory'
import { createScanner } from './storage.scanner-factory'
import type { ScanConfig, ScanResult } from './storage.scan.types'
import type { UploadedFile } from './entities/uploaded_file.entity'

/**
 * Run a single scan with an already-resolved config. The scanner adapter never
 * throws for ordinary failures (it returns `status: 'error'`), so this is safe
 * to await inline without try/catch — but we guard anyway as defence in depth.
 */
/** Who an infected file is reported for (phase 55 00 §0.3): the tenant, the uploader when there is one, and where the file was going. */
export interface ScanAuditContext {
  tenantId: string
  userId?: string | null
  /** `sync` refused the upload before it was stored; `async` found it stored and quarantines or deletes it. */
  mode: 'sync' | 'async'
  uploadedFileId?: string | null
  /** The object key (async) or the folder the upload was meant for (sync). */
  key?: string | null
}

/**
 * Phase 55 00 §0.3 (P-3): an infected file used to leave a log line only. It is now on the tenant's record as `file.infected` (critical), counted per
 * uploader (or, for a server upload, per tenant) and minute, with the scanner's verdict and the first few object keys. Never the bytes.
 */
export function reportInfected(result: ScanResult, filename: string, ctx: ScanAuditContext): void {
  void reportRefusal({
    action: 'file.infected',
    tenantId: ctx.tenantId,
    key: ctx.userId ? `user:${ctx.userId}` : `tenant:${ctx.tenantId}`,
    actorId: ctx.userId ?? null,
    actorType: ctx.userId ? 'USER' : 'SYSTEM',
    resourceType: 'uploaded_file',
    resourceId: ctx.uploadedFileId ?? null,
    metadata: {
      mode: ctx.mode,
      provider: result.provider,
      threat: result.threat ? String(result.threat).slice(0, 120) : null,
      filename: filename.slice(0, 120),
    },
    sample: ctx.key ?? filename,
  })
}

export async function scan(config: ScanConfig, bytes: Uint8Array, filename: string, audit?: ScanAuditContext): Promise<ScanResult> {
  try {
    const scanner = createScanner(config)
    const result = await scanner.scan(bytes, { filename, timeoutMs: config.timeoutMs })
    if (result.status === 'infected' && audit) reportInfected(result, filename, audit)
    return result
  } catch (error) {
    Logger.warn(`storage scan failed: ${error instanceof Error ? error.message : String(error)}`)
    return { status: 'error', provider: config.provider, detail: 'scan error' }
  }
}

/**
 * React to an infected object. The malicious bytes are ALWAYS removed from the
 * serving location; with `quarantine` they are first copied to the quarantine
 * folder (falling back to plain delete if the copy fails, so an infected object
 * is never left publicly reachable).
 */
export async function handleInfected(
  tenantId: string,
  row: Pick<UploadedFile, 'key' | 'mimeType' | 'size'> & Partial<Pick<UploadedFile, 'source'>>,
  bytes: Uint8Array,
  config: ScanConfig,
): Promise<void> {
  // Phase 53.5: on the side the object was stored on.
  const { provider } = row.source ? await getProvider(tenantId, undefined, { source: row.source }) : await getProvider(tenantId)
  const base = row.key.split('/').pop() || 'file'

  if (config.infectedAction === 'quarantine') {
    try {
      await provider.uploadFile(
        new File([bytes as unknown as BlobPart], base, { type: row.mimeType }),
        { folder: config.quarantineFolder, tenantId },
      )
      await provider.deleteFile(row.key)
      Logger.info(`storage: quarantined infected object ${row.key}`)
      return
    } catch (error) {
      Logger.warn(
        `storage: quarantine failed for ${row.key}, deleting instead: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  await provider.deleteFile(row.key)
  const size = Number(row.size) || 0
  if (size > 0 && row.source !== 'tenant') {
    await TenantUsageService.decrementStorageBytes(tenantId, size).catch(() => {})
  }
  Logger.info(`storage: deleted infected object ${row.key}`)
}
