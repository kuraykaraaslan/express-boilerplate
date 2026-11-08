import type { UploadOptions, UploadFromUrlOptions, ProviderUploadResult, S3Config } from '../storage.types'

export default abstract class BaseStorageProvider {
  protected config: S3Config

  constructor(config: S3Config) {
    this.config = config
  }

  abstract uploadFile(file: File, options?: UploadOptions): Promise<ProviderUploadResult>
  abstract uploadFromUrl(url: string, options?: UploadFromUrlOptions): Promise<ProviderUploadResult>
  abstract deleteFile(key: string): Promise<void>
  abstract getFileUrl(key: string): string

  /**
   * A URL a browser can fetch the object from for `expiresSeconds`. Backends that publish objects at a stable public URL answer
   * `getFileUrl` (the default); a backend that serves private objects itself (the local disk provider) signs a short-lived one.
   */
  getReadUrl(key: string, expiresSeconds: number): string {
    void expiresSeconds
    return this.getFileUrl(key)
  }

  /**
   * The real path of the object on this server's disk, or null when there is none. Only a disk backed provider (the local one)
   * has it; server code that reads objects back (`getServerReadUrl` in storage.operations) goes straight to the file with it.
   */
  getServerPath?(key: string): Promise<string | null>

  /** Writes `bytes` at exactly `key` (a migrated tenant's objects; the caller has vouched for the key). */
  putObjectAtKey?(key: string, bytes: Buffer, contentType: string): Promise<void>

  /** The bucket (and custom endpoint) this provider writes to, for callers that must address the same place. */
  describeTarget(): { bucket: string; endpoint?: string; region?: string } {
    return { bucket: this.config.bucket, endpoint: this.config.endpoint, region: this.config.region }
  }
}
