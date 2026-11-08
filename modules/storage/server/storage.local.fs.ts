import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath, rename, statfs, unlink, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'

/**
 * The filesystem half of the local provider. Every path is built from a key and checked twice: lexically (the key is a plain
 * `<tenant>/<folder>/<file>` chain of segments with no `.`, `..`, separator or NUL) and against the real filesystem (the
 * directory a write lands in, and an object that is read, must resolve to a place INSIDE the real base directory, so a symlink
 * planted in the tree, to a directory or to a file, reaches nothing outside it). Writes are atomic: the bytes go to a
 * temporary file in the destination directory and are renamed into place, so a reader sees the old object or the whole new one.
 */

const notFound = () => new AppError('Object not found', 404, ErrorCode.NOT_FOUND)
const badKey = () => new AppError('Invalid object key', 400, ErrorCode.VALIDATION_ERROR)
const noSpace = () => new AppError('Local storage has no free space left', 507, ErrorCode.QUOTA_EXCEEDED)

/** The segments of a key, or a 400: no empty, `.` or `..` segment, no backslash, NUL or control character, at most 1024 characters. */
export function keySegments(key: unknown): string[] {
  if (typeof key !== 'string' || key.length === 0 || key.length > 1024 || /[\\\x00-\x1f\x7f]/.test(key)) throw badKey()
  const segs = key.split('/')
  if (segs.length < 2 || segs.some((s) => s === '' || s === '.' || s === '..' || s.length > 255)) throw badKey()
  return segs
}

const inside = (root: string, p: string) => p === root || p.startsWith(root.endsWith(path.sep) ? root : root + path.sep)

/** Create the base directory (mode 0700) when missing and answer its real path. */
export async function ensureRoot(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true, mode: 0o700 })
  return realpath(dir)
}

/** The lexical path of a key under a real root; throws 400 when it would leave it. */
function lexicalPath(realRoot: string, key: string): string {
  const p = path.resolve(realRoot, ...keySegments(key))
  if (!inside(realRoot, p) || p === realRoot) throw badKey()
  return p
}

/**
 * The real path of an existing object, or null when there is none. A symlink (the object itself, or any directory on its way) that
 * resolves outside the real root is a 404, the same answer as a missing file: nothing tells a prober a link exists.
 */
export async function resolveExisting(root: string, key: string): Promise<string | null> {
  let realRoot: string
  try { realRoot = await realpath(root) } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e }
  const p = lexicalPath(realRoot, key)
  let real: string
  try { real = await realpath(p) } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return null
    throw e
  }
  // Inside this tenant's own subtree, not just the base directory: a link from one tenant's tree to another's reaches nothing.
  if (!inside(path.join(realRoot, keySegments(key)[0]), real)) return null
  const st = await lstat(real)
  return st.isFile() ? real : null
}

/** The free bytes of the volume holding `dir`. */
export async function freeBytes(dir: string): Promise<number> {
  const s = await statfs(dir)
  return Number(s.bavail) * Number(s.bsize)
}

/**
 * Write `bytes` at `key` atomically, replacing what is there. Refuses (507) a write that would leave less than `minFreeBytes`
 * free on the volume. Directories are created 0700, the file 0600.
 */
export async function writeObject(root: string, key: string, bytes: Uint8Array, minFreeBytes: number): Promise<void> {
  const realRoot = await ensureRoot(root)
  const target = lexicalPath(realRoot, key)
  if (minFreeBytes > 0 && (await freeBytes(realRoot)) - bytes.byteLength < minFreeBytes) throw noSpace()
  const dirPath = path.dirname(target)
  await mkdir(dirPath, { recursive: true, mode: 0o700 })
  await sweepStaleTemps(dirPath)
  // A symlinked directory in the tree would carry the write out of the root.
  if (!inside(realRoot, await realpath(dirPath))) throw badKey()
  const tmp = path.join(dirPath, `.tmp-${randomUUID()}`)
  let handle: FileHandle | undefined
  try {
    handle = await open(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
    await handle.writeFile(bytes)
    await handle.sync()
    await handle.close()
    handle = undefined
    // rename(2) replaces a symlink at the target itself, it never follows it.
    await rename(tmp, target)
  } catch (e) {
    await handle?.close().catch(() => undefined)
    await unlink(tmp).catch(() => undefined)
    throw e
  }
}

const sweptDirs = new Set<string>()
const STALE_TMP_MS = 3600_000

/** Once per process and directory, remove `.tmp-*` files a crash left behind (older than an hour, so a write in flight is never touched). */
async function sweepStaleTemps(dirPath: string): Promise<void> {
  if (sweptDirs.has(dirPath)) return
  sweptDirs.add(dirPath)
  try {
    for (const name of await readdir(dirPath)) {
      if (!name.startsWith('.tmp-')) continue
      const p = path.join(dirPath, name)
      const st = await lstat(p).catch(() => null)
      if (st?.isFile() && Date.now() - st.mtimeMs > STALE_TMP_MS) await unlink(p).catch(() => undefined)
    }
  } catch { /* best effort: a failed sweep never fails a write */ }
}

/** Remove the object at `key`. Missing is fine (the same as the bucket providers). A symlink at the key is removed as a link, never followed. */
export async function deleteObject(root: string, key: string): Promise<void> {
  let realRoot: string
  try { realRoot = await realpath(root) } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e }
  const target = lexicalPath(realRoot, key)
  // The directory part must be a real one inside the root; the last segment may be anything and is only unlinked.
  let dirReal: string
  try { dirReal = await realpath(path.dirname(target)) } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return
    throw e
  }
  if (!inside(realRoot, dirReal)) return
  try { await unlink(path.join(dirReal, path.basename(target))) } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
}

export { notFound as objectNotFound }
