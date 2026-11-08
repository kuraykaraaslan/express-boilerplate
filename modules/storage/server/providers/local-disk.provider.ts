import { hostname } from 'node:os'
import { v4 as uuidv4 } from 'uuid'
import { IsolatedStorageProvider } from './isolated.provider'
import type { LocalStorageConfig } from '../storage.local.config'
import { resolveExisting } from '../storage.local.fs'
import { FILE_URL_TTL_SECONDS, isPublicKey, signLocalUrl } from '../storage.local.signing'

/** The bucket name an upload result carries: there is none on a disk. */
export const LOCAL_BUCKET = 'local'

/** The provider key the local disk plugin (`@local/storage`) contributes under; the value of `storageProvider`. */
export const LOCAL_PROVIDER_KEY = 'local'

type Invoke = (op: string, input: unknown) => Promise<unknown>

/**
 * Host-side facade of the local disk storage plugin (`modules/marketplace/examples/@local/storage`), the counterpart of
 * `IsolatedStorageProvider` for a bucket plugin. Like every storage backend the plugin runs sandboxed: `putObject` and
 * `deleteObject` go into its isolate, which hands them to the broker's `localfs` capability (the isolate has no filesystem, the
 * same way the SMTP plugin hands its message to the `smtp` capability). Validation and key generation are the inherited ones.
 *
 * What differs from a bucket is how an object is reached, and that is built here, host-side, like a bucket's public URL:
 * browsers get app-signed URLs (`storage.local.signing.ts`, served by `storage-local-object.route.ts`), server code reads the file
 * through `getServerPath` (storage.operations `getServerReadUrl` turns it into the `file://` URL its readers open).
 */
export class LocalDiskProvider extends IsolatedStorageProvider {
  constructor(invoke: Invoke, private readonly local: LocalStorageConfig, private readonly tenantId: string) {
    super(invoke, { bucket: LOCAL_BUCKET, region: 'local' })
  }

  /** The signed URL stored with an upload and answered by `getFileUrl`: 7 days, or no expiry under `branding/`, `avatars/`, `headers/`. */
  getFileUrl(key: string): string {
    // An empty key is the URL prefix a migration rewrites stored URLs from: the unsigned route of this tenant.
    if (!key) return `${signLocalUrl(`${this.tenantId}/x`, 1).split('?')[0]}?key=`
    return signLocalUrl(key, isPublicKey(key) ? 0 : FILE_URL_TTL_SECONDS)
  }

  getReadUrl(key: string, expiresSeconds: number): string {
    return signLocalUrl(key, expiresSeconds)
  }

  describeTarget(): { bucket: string; endpoint?: string; region?: string } {
    // The host name is part of the identity: two machines with the same path are two stores, never one shared bucket.
    return { bucket: LOCAL_BUCKET, endpoint: `file://${hostname()}${this.local.dir}`, region: 'local' }
  }

  /** A key always lies under a tenant on the disk (the `localfs` capability refuses any other): the provider's own when the options name none. */
  protected fallbackTenantId(): string {
    return this.tenantId
  }

  /** Generated keys are plain path segments on a disk: base name and extension are sanitised (a bucket would only encode them). */
  protected generateFileKey(tenantId: string, folder: string, filename: string, extension?: string): string {
    const ext = (extension || filename.split('.').pop()?.toLowerCase() || '').replace(/[^a-z0-9]+/g, '').slice(0, 16)
    const baseName = filename.split('.')[0].replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'file'
    return `${tenantId}/${folder}/${Date.now()}-${uuidv4().slice(0, 8)}-${baseName}.${ext}`
  }

  /** The real path of the object, or null (missing, or a link out of the tenant's subtree). */
  async getServerPath(key: string): Promise<string | null> {
    return resolveExisting(this.local.dir, key)
  }
}
