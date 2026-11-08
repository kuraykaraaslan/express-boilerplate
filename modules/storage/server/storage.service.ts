import { UploadFileDTO, UploadFromUrlDTO, DeleteFileDTO, GetFileUrlDTO } from './storage.dto'
import { UploadResult } from './storage.types'
import {
  assertDeclaredUploadSize, uploadFile, uploadFromUrl, deleteFile, getFileUrl,
  getPresignedUrl, getServerReadUrl, uploadServerBuffer, putStaticObject, hardDeleteFile, downloadBuffer,
  type PresignGetOptions,
} from './storage.operations'
import {
  createDownloadLink, revokeDownloadLink, listDownloadLinks,
  type CreateDownloadLinkOptions, type CreatedDownloadLink, type DownloadLinkSummary,
} from './storage.links'
import { getStorageUsageSummary, type StorageUsageSummary } from './storage.audit'
import {
  presignUpload, completeUpload,
  type PresignUploadContext, type PresignUploadResult, type CompleteUploadContext, type CompleteUploadResult,
} from './storage.direct-upload'
import type { PresignUploadDTO } from './storage.dto'
import {
  getBucketCorsStatus, applyBucketCors,
  type BucketCorsStatus, type BucketCorsApplyResult, type ApplyBucketCorsContext,
} from './storage.bucket-cors'

/**
 * Storage service facade. The implementation is split across focused modules
 * (`storage.provider-factory`, `storage.audit`, `storage.operations`); this
 * class preserves the single `StorageService.*` entry point its callers depend on.
 */
export default class StorageService {
  static uploadFile(tenantId: string, data: UploadFileDTO): Promise<UploadResult> {
    return uploadFile(tenantId, data)
  }

  /** 413 when a request's declared Content-Length is over the tenant's cap; call it before `formData()`. */
  static assertDeclaredUploadSize(tenantId: string, contentLength: string | null): Promise<void> {
    return assertDeclaredUploadSize(tenantId, contentLength)
  }

  /**
   * Browser-direct upload, step 1: check the declaration and answer either a
   * presigned PUT (`mode: 'direct'`) or `mode: 'multipart'` (use the upload
   * route). See `storage.direct-upload.ts`.
   */
  static presignUpload(tenantId: string, input: PresignUploadDTO, ctx: PresignUploadContext): Promise<PresignUploadResult> {
    return presignUpload(tenantId, input, ctx)
  }

  /** Browser-direct upload, step 3: verify the PUT object and record the file. Single-use, idempotent. */
  static completeUpload(tenantId: string, uploadId: string, ctx: CompleteUploadContext): Promise<CompleteUploadResult> {
    return completeUpload(tenantId, uploadId, ctx)
  }

  /**
   * Does the tenant's bucket allow the browser-direct PUT from every app origin?
   * Read-only. See `storage.bucket-cors.ts`.
   */
  static getBucketCorsStatus(tenantId: string): Promise<BucketCorsStatus> {
    return getBucketCorsStatus(tenantId)
  }

  /** Merge the direct-upload CORS rule into the tenant's bucket (other rules are kept). Audited. */
  static applyBucketCors(tenantId: string, ctx: ApplyBucketCorsContext = {}): Promise<BucketCorsApplyResult> {
    return applyBucketCors(tenantId, ctx)
  }

  static uploadFromUrl(tenantId: string, data: UploadFromUrlDTO): Promise<UploadResult> {
    return uploadFromUrl(tenantId, data)
  }

  static deleteFile(tenantId: string, data: DeleteFileDTO): Promise<void> {
    return deleteFile(tenantId, data)
  }

  static getFileUrl(tenantId: string, data: GetFileUrlDTO): Promise<string> {
    return getFileUrl(tenantId, data)
  }

  static getPresignedUrl(tenantId: string, key: string, expiresSeconds = 900, opts?: PresignGetOptions): Promise<string> {
    return opts ? getPresignedUrl(tenantId, key, expiresSeconds, opts) : getPresignedUrl(tenantId, key, expiresSeconds)
  }

  static getServerReadUrl(tenantId: string, key: string, expiresSeconds = 120): Promise<string> {
    return getServerReadUrl(tenantId, key, expiresSeconds)
  }

  static downloadBuffer(tenantId: string, key: string, opts?: { maxBytes?: number }): Promise<Buffer> {
    return opts ? downloadBuffer(tenantId, key, opts) : downloadBuffer(tenantId, key)
  }

  static uploadServerBuffer(
    tenantId: string,
    data: { buffer: Buffer; filename: string; contentType?: string; folder?: string; scan?: boolean; trusted?: boolean },
  ): Promise<UploadResult> {
    return uploadServerBuffer(tenantId, data)
  }

  /** A server-generated object at a stable key, overwritten in place: no audit row, no metering (see `putStaticObject`). */
  static putStaticObject(
    tenantId: string,
    data: { buffer: Buffer; filename: string; contentType: string; folder: string },
  ): Promise<{ key: string; url: string; bucket: string; size: number | undefined }> {
    return putStaticObject(tenantId, data)
  }

  static hardDeleteFile(tenantId: string, data: DeleteFileDTO): Promise<void> {
    return hardDeleteFile(tenantId, data)
  }

  /**
   * App-signed link a machine without a session can fetch (any provider, `Range`,
   * TTL ceiling, audit, revocation). See README "Links for machines".
   */
  static createDownloadLink(tenantId: string, key: string, opts: CreateDownloadLinkOptions): Promise<CreatedDownloadLink> {
    return createDownloadLink(tenantId, key, opts)
  }

  static revokeDownloadLink(tenantId: string, linkId: string): Promise<boolean> {
    return revokeDownloadLink(tenantId, linkId)
  }

  static listDownloadLinks(tenantId: string, filter: { purpose?: string } = {}): Promise<DownloadLinkSummary[]> {
    return listDownloadLinks(tenantId, filter)
  }

  /**
   * Report the tenant's storage quota usage: used bytes, plan quota (bytes),
   * and remaining headroom. `quotaBytes` / `remainingBytes` are `-1` when the
   * quota is unlimited. Reuses the same usage + quota source the pre-upload
   * gate (`assertStorageFeatureAccess`) checks against.
   */
  static getUsageSummary(tenantId: string): Promise<StorageUsageSummary> {
    return getStorageUsageSummary(tenantId)
  }
}
