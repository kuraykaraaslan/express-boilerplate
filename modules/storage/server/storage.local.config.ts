import path from 'node:path'
import { env } from '@kuraykaraaslan-labs/env'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants'
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service'
import { STORAGE_LOCAL_KEYS } from './storage.local.setting.keys'

/** Free space kept on the volume when `storageLocalMinFreeMb` is unset: a write that would leave less is refused. */
export const DEFAULT_MIN_FREE_MB = 512

/** The directory used when neither the setting nor `STORAGE_LOCAL_DIR` names one (gitignored, like the old `npm run storage:local`). */
export const DEFAULT_DIR_NAME = '.local-storage'

export interface LocalStorageConfig {
  /** Absolute, normalised base directory. */
  dir: string
  /** Bytes that must stay free on the volume after a write. */
  minFreeBytes: number
}

/**
 * The base directory a value names, or a 422. Absolute paths only: a relative one would move with the process's working
 * directory, and a `..` anywhere is refused before normalising so the stored value says what it means. The filesystem root
 * is refused (every object would sit beside the system's own files).
 */
export function parseLocalDir(value: string): string {
  const bad = (why: string) => new AppError(`Invalid local storage directory: ${why}`, 422, ErrorCode.VALIDATION_ERROR)
  const raw = value.trim()
  if (!raw) throw bad('empty')
  if (raw.length > 512 || raw.includes('\0')) throw bad('too long or not text')
  if (!path.isAbsolute(raw)) throw bad('it must be an absolute path')
  if (raw.split(/[\\/]+/).includes('..')) throw bad('it must not contain ..')
  const dir = path.resolve(raw)
  if (dir === path.parse(dir).root) throw bad('it must not be the filesystem root')
  return dir
}

/** `storageLocalMinFreeMb` as bytes; an unset, non-numeric or negative value is the default (0 switches the floor off). */
export function parseMinFreeBytes(value: string | undefined): number {
  const mb = value === undefined || value.trim() === '' ? NaN : Number(value)
  const effective = Number.isFinite(mb) && mb >= 0 ? Math.floor(mb) : DEFAULT_MIN_FREE_MB
  return effective * 1024 * 1024
}

/**
 * The installation's local-disk settings, read from the ROOT tenant only, never from the tenant asking, so a tenant admin
 * cannot point the provider at a directory of its choice (the keys are also refused in any other tenant, `PLATFORM_ONLY_SETTING_KEYS`).
 * Order: the setting, then `STORAGE_LOCAL_DIR`, then `<working directory>/.local-storage`.
 */
export async function getLocalStorageConfig(): Promise<LocalStorageConfig> {
  const s = await SettingService.getByKeys(ROOT_TENANT_ID, [...STORAGE_LOCAL_KEYS])
  const configured = s.storageLocalDir?.trim() || env.STORAGE_LOCAL_DIR?.trim() || path.join(process.cwd(), DEFAULT_DIR_NAME)
  return { dir: parseLocalDir(configured), minFreeBytes: parseMinFreeBytes(s.storageLocalMinFreeMb) }
}
