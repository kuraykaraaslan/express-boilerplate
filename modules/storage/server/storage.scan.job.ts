import { Queue, Worker, Job } from 'bullmq'
import { getBullMQConnection } from '@kuraykaraaslan-labs/redis/server/redis.bullmq'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import Logger from '@kuraykaraaslan-labs/logger'
import { UploadedFile } from './entities/uploaded_file.entity'
import { getScanConfig } from './storage.scanner-factory'
import { getStorageSettings } from './storage.provider-factory'
import { scopeOfSource } from './storage.source'
import { presignS3GetUrl } from './storage.sigv4'
import { scan, handleInfected } from './storage.scan.service'
import { updateScanResult } from './storage.audit'
import { registerWorkerDrain } from '@kuraykaraaslan-labs/common/server/process-hooks'
import { storageFetch } from './storage.safe-fetch'

/**
 * Background virus scan for uploads made in async mode. The object is already
 * in the bucket with `scanStatus='pending'`; this job downloads it, scans it,
 * writes the result back, and quarantines/deletes it if infected.
 *
 * Mirrors `tenant_usage.job.ts`: shared BullMQ connection, bounded retention,
 * retry with exponential backoff.
 */
const QUEUE_NAME = 'storage-virus-scan'

interface ScanJobData {
  uploadedFileId: string
  key: string
  tenantId: string
}

export const virusScanQueue = new Queue<ScanJobData>(QUEUE_NAME, {
  connection: getBullMQConnection(),
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 500,
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  },
})

/** Process one scan job: download → scan → record → quarantine/delete. */
export async function processScanJob(job: Job<ScanJobData>): Promise<{ uploadedFileId: string; status: string }> {
  const { uploadedFileId, key, tenantId } = job.data

  const config = await getScanConfig(tenantId)
  if (!config.enabled) {
    Logger.info(`[Job:virus-scan] scanning disabled for ${tenantId}, skipping ${uploadedFileId}`)
    return { uploadedFileId, status: 'skipped' }
  }

  // Load the audit row (mimeType/size needed for quarantine + usage). Only the
  // read goes through the chokepoint — the download + scan below are I/O and
  // must not run inside its transaction (db.context.ts's "keep the block
  // short" rule).
  const row = await withTenantRepositoryFor(tenantId, UploadedFile, (repo) => repo.findOne({
    where: { uploadedFileId, tenantId },
  }))
  if (!row) {
    Logger.warn(`[Job:virus-scan] audit row ${uploadedFileId} not found`)
    return { uploadedFileId, status: 'error' }
  }

  // Download the object via a short-lived presigned URL (the local disk: read the file; no bucket to sign for).
  const scope = scopeOfSource(tenantId, row.source)
  const { providerName, config: s3 } = scope ? await getStorageSettings(tenantId, scope) : await getStorageSettings(tenantId)
  let bytes: Uint8Array
  if (providerName === 'local') {
    // Dynamic: storage.operations imports this file (enqueueVirusScan).
    const { downloadBuffer } = await import('./storage.operations')
    bytes = new Uint8Array(await downloadBuffer(tenantId, key))
  } else {
    const url = presignS3GetUrl(s3, key, 300)
    const res = await storageFetch(url) // storage.08
    if (!res.ok) {
      Logger.warn(`[Job:virus-scan] download failed (${res.status}) for ${key}`)
      throw new Error(`download failed: ${res.status}`) // retryable
    }
    bytes = new Uint8Array(await res.arrayBuffer())
  }

  const result = await scan(config, bytes, key.split('/').pop() || 'file', {
    tenantId, userId: row.userId ?? null, mode: 'async', uploadedFileId, key,
  })
  await updateScanResult(tenantId, uploadedFileId, result)

  if (result.status === 'infected') {
    await handleInfected(tenantId, row, bytes, config)
  }

  Logger.info(`[Job:virus-scan] ${uploadedFileId} → ${result.status}`)
  return { uploadedFileId, status: result.status }
}

let _worker: Worker<ScanJobData> | null = null

/**
 * Start the scan worker. Called once at boot in the worker runtime — NOT on the
 * upload request path (which only enqueues), so no consumer is spun up in the
 * web/serverless runtime.
 */
export function startVirusScanWorker(): Worker<ScanJobData> {
  if (_worker) return _worker
  _worker = new Worker<ScanJobData>(QUEUE_NAME, processScanJob, {
    connection: getBullMQConnection(),
    concurrency: 5,
  })
  _worker.on('failed', (job, err) => {
    Logger.error(`[Job:virus-scan] Job ${job?.id} (${job?.data?.uploadedFileId}) failed: ${err.message}`)
  })
  registerWorkerDrain(_worker)
  return _worker
}

/** Enqueue an async virus scan for a freshly uploaded object. */
export async function enqueueVirusScan(
  uploadedFileId: string,
  key: string,
  tenantId: string,
): Promise<void> {
  await virusScanQueue.add(
    'scan',
    { uploadedFileId, key, tenantId },
    { jobId: `scan-${uploadedFileId}` },
  )
}
