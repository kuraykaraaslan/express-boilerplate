import { z } from 'zod'

// ============================================================================
// Local disk storage settings (platform level: read from the ROOT tenant only)
// ============================================================================

export const StorageLocalSettingKeySchema = z.enum([
  // Absolute base directory of the objects (default: STORAGE_LOCAL_DIR, else <working directory>/.local-storage).
  'storageLocalDir',
  // Free space, in MB, that must stay on the volume after a write (default 512; 0 switches the floor off).
  'storageLocalMinFreeMb',
])
export type StorageLocalSettingKey = z.infer<typeof StorageLocalSettingKeySchema>
export const STORAGE_LOCAL_KEYS = StorageLocalSettingKeySchema.options
