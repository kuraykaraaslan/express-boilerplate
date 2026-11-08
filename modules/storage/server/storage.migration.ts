import { createHash } from 'node:crypto'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { getServerReadUrl } from './storage.operations'
import { getProvider } from './storage.provider-factory'
import { IsolatedStorageProvider } from './providers/isolated.provider'
import { canSignForTenantBucket, putSignedObject } from './storage.direct-upload'
import { DIRECT_UPLOAD_MAX_BYTES, MAX_UPLOAD_FILE_BYTES } from './storage.validation'
import { storageFetch } from './storage.safe-fetch'

/**
 * Storage's side of a fleet tenant migration (docs/phases/02-fleet/05 section 6.3 "Objects", P6-MIGRATION-BUNDLE slice 3): the migration bundle carries
 * the tenant's objects, so the source reads them, the target writes them at the same keys into its own store, and the source's purge removes them once the
 * target holds them. Everything here is keyed by the tenant's own provider on THIS node (`getProvider`): on a fleet node the storage settings are the
 * node's (`storageProvider` / `s3*` are node-owned and never travel), so "the target bucket" is whatever the tenant resolves to on the target.
 *
 * No audit rows and no metering here: the tenant's `uploaded_files` rows travel with its rows and are re-pointed at the target store by the importer,
 * and its usage counter travels with them.
 */

/** Whether `key` lies under the tenant's prefix (the only keys a migration ever reads, writes or deletes). */
export function isTenantObjectKey(tenantId: string, key: string): boolean {
  return key.startsWith(`${tenantId}/`) && !key.split('/').slice(1).some((s) => s === '' || s === '.' || s === '..')
}

function assertTenantKey(tenantId: string, key: string): void {
  if (!isTenantObjectKey(tenantId, key)) throw new AppError('Object key outside the tenant prefix', 400, ErrorCode.VALIDATION_ERROR)
}

/** Where the tenant's objects live on this node: the provider, bucket, its G-safe hash, and what a stored object's URL starts with (then its key). */
export interface ObjectStoreIdentity {
  provider: string
  bucket: string
  /** `objectStoreHash` of the store: two nodes that would read and write the same objects have the same hash. */
  hash: string
  /** The provider's object URL for a key is this prefix followed by the key. */
  urlPrefix: string
}

/**
 * The hash two nodes compare to learn whether they share one object store (then nothing is copied, and nothing deleted at the source): sha256 over the
 * endpoint's host and port (scheme, case and trailing slashes ignored; AWS without an endpoint is `s3.amazonaws.com`, its bucket names being global) and
 * the bucket. The provider's name is left out on purpose: `minio` and `s3` pointed at one bucket are one store. A store reached under two host names
 * hashes as two stores, which is why every fleet node has a bucket of its own (05 section 2 "Objects").
 */
export function objectStoreHash(endpoint: string | undefined, bucket: string): string {
  const host = (endpoint ?? '').trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/\/+$/, '') || 's3.amazonaws.com'
  return createHash('sha256').update(`fleet-object-store-v1\n${host}\n${bucket}`, 'utf8').digest('hex')
}

export async function migrationObjectStore(tenantId: string): Promise<ObjectStoreIdentity> {
  const { provider, resolvedName } = await getProvider(tenantId)
  const { bucket, endpoint } = provider.describeTarget()
  return { provider: resolvedName, bucket, hash: objectStoreHash(endpoint, bucket), urlPrefix: provider.getFileUrl('') }
}

/** The local store answers a missing object with a 404 where a bucket answers with a 404 from its own GET: both mean "no such object". */
function notFoundAsNull(e: unknown): null {
  if (e instanceof AppError && e.statusCode === 404) return null
  throw e
}

/** The object's bytes as a stream, or null when the store has no object at `key` (404, or no such file); any other failure throws. */
export async function readMigrationObject(tenantId: string, key: string): Promise<AsyncIterable<Uint8Array> | null> {
  assertTenantKey(tenantId, key)
  const url = await getServerReadUrl(tenantId, key, 900).catch(notFoundAsNull)
  if (url === null) return null
  if (url.startsWith('file://')) {
    const [{ createReadStream }, { stat }, { fileURLToPath }] = await Promise.all([import('node:fs'), import('node:fs/promises'), import('node:url')])
    const path = fileURLToPath(url)
    try { if (!(await stat(path)).isFile()) return null } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e }
    return createReadStream(path)
  }
  const res = await storageFetch(url) // storage.08
  if (res.status === 404) return null
  if (!res.ok || !res.body) throw new AppError(`Failed to read object (${res.status})`, 502, ErrorCode.INTERNAL_ERROR)
  return res.body as unknown as AsyncIterable<Uint8Array>
}

/**
 * The largest object `putMigrationObject` writes through the sandboxed provider: what an ordinary upload carries through it (base64 across the isolate
 * boundary, bounded by the isolate's memory). A larger object needs a host-signed PUT.
 */
export const MIGRATION_ISOLATE_PUT_MAX_BYTES = MAX_UPLOAD_FILE_BYTES

/**
 * The largest migrated object this node can write into the tenant's store: up to `DIRECT_UPLOAD_MAX_BYTES` (the largest object a tenant can hold, a
 * browser-direct upload) when the host can sign for the provider's bucket, else only what the isolate carries. The importer refuses a bundle with a
 * larger object before it writes one, so a store that could never take it does not leave the import failing on every retry.
 */
export async function migrationObjectMaxBytes(tenantId: string): Promise<number> {
  // A disk takes the bytes as a stream of writes in this process: no isolate in the way, no bucket to sign for.
  if ((await getProvider(tenantId)).provider.getServerPath) return DIRECT_UPLOAD_MAX_BYTES
  return (await canSignForTenantBucket(tenantId)) ? DIRECT_UPLOAD_MAX_BYTES : MIGRATION_ISOLATE_PUT_MAX_BYTES
}

/**
 * Writes a migrated object at exactly `key` into the tenant's store on this node (overwriting: a retried import writes the same bytes again). Up to
 * `MIGRATION_ISOLATE_PUT_MAX_BYTES` through the sandboxed provider; a larger object as the body of a host-signed PUT (`putSignedObject`), never as a
 * base64 string (V8 refuses a string past about 400 MB, and the isolate's memory far sooner); refused (413) where the host cannot sign.
 */
export async function putMigrationObject(tenantId: string, key: string, bytes: Buffer, contentType: string): Promise<void> {
  assertTenantKey(tenantId, key)
  await writeAtKey(tenantId, key, bytes, contentType)
}

/** Writes `bytes` at exactly `key` into the store `storeTenantId` resolves to on this node: through the isolate up to its limit, a host-signed PUT above. */
async function writeAtKey(storeTenantId: string, key: string, bytes: Buffer, contentType: string): Promise<void> {
  const diskStore = (await getProvider(storeTenantId)).provider
  if (diskStore.getServerPath && diskStore.putObjectAtKey) {
    if (bytes.length > DIRECT_UPLOAD_MAX_BYTES) throw new AppError('Object too large for this store', 413, ErrorCode.VALIDATION_ERROR)
    await diskStore.putObjectAtKey(key, bytes, contentType)
    return
  }
  if (bytes.length > MIGRATION_ISOLATE_PUT_MAX_BYTES) {
    if (bytes.length > DIRECT_UPLOAD_MAX_BYTES || !(await putSignedObject(storeTenantId, key, bytes, contentType))) throw new AppError('Object too large for this store', 413, ErrorCode.VALIDATION_ERROR)
    return
  }
  const { provider } = await getProvider(storeTenantId)
  if (!(provider instanceof IsolatedStorageProvider)) throw new AppError('Storage provider cannot write at a key', 500, ErrorCode.INTERNAL_ERROR)
  await provider.putObjectAtKey(key, bytes, contentType)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * `npm run tenant:rekey` (docs/phases/46-module-placement, D46-6): copies the object at `key`, under `fromTenantId/`, to the same path under
 * `toTenantId/`, in the store `fromTenantId` resolves to now. The move calls it before its rows move, so that is the moving tenant's own store (its
 * storage settings move with it). The original is never deleted: the backup taken before the move, and every URL that names it, keep working.
 * Answers the new key, or null when the store has no object at `key` (a row that named nothing still names nothing).
 */
export async function copyObjectToTenantPrefix(fromTenantId: string, toTenantId: string, key: string): Promise<string | null> {
  assertTenantKey(fromTenantId, key)
  if (!UUID_RE.test(toTenantId) || toTenantId === fromTenantId) throw new AppError('Not a tenant to copy the object to', 400, ErrorCode.VALIDATION_ERROR)
  const newKey = `${toTenantId}/${key.slice(fromTenantId.length + 1)}`
  const url = await getServerReadUrl(fromTenantId, key, 900).catch(notFoundAsNull)
  if (url === null) return null
  if (url.startsWith('file://') && (await getProvider(fromTenantId)).provider.getServerPath) {
    // the local disk store: read the object and write it at the new key through the provider (atomic, inside the base directory, free-space floor)
    const [{ readFile }, { fileURLToPath }] = await Promise.all([import('node:fs/promises'), import('node:url')])
    await writeAtKey(fromTenantId, newKey, await readFile(fileURLToPath(url)), 'application/octet-stream')
    return newKey
  }
  if (url.startsWith('file://')) {
    // a plugin answering to the local key: the file next to it on disk, the object's path with the key swapped
    const [{ copyFile, mkdir, stat }, { dirname }, { fileURLToPath }] = await Promise.all([import('node:fs/promises'), import('node:path'), import('node:url')])
    const path = fileURLToPath(url)
    if (!path.endsWith(key)) throw new AppError('Local object path does not end with its key', 500, ErrorCode.INTERNAL_ERROR)
    try { if (!(await stat(path)).isFile()) return null } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e }
    const target = `${path.slice(0, path.length - key.length)}${newKey}`
    await mkdir(dirname(target), { recursive: true })
    await copyFile(path, target)
    return newKey
  }
  const res = await storageFetch(url)
  if (res.status === 404) return null
  if (!res.ok) throw new AppError(`Failed to read object (${res.status})`, 502, ErrorCode.INTERNAL_ERROR)
  const bytes = Buffer.from(await res.arrayBuffer())
  await writeAtKey(fromTenantId, newKey, bytes, res.headers.get('content-type') || 'application/octet-stream')
  return newKey
}

/** Deletes a migrated object at `key` from the tenant's store on this node (a source purge, or a target abort); no row is touched. */
export async function deleteMigrationObject(tenantId: string, key: string): Promise<void> {
  assertTenantKey(tenantId, key)
  const { provider } = await getProvider(tenantId)
  await provider.deleteFile(key)
}
