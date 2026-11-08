import { z } from 'zod';

// ============================================================================
// Storage Setting Keys (System-level storage configuration)
// ============================================================================

export const StorageSettingKeySchema = z.enum([
  'storageProvider', 's3Bucket', 's3Region', 's3AccessKey', 's3SecretKey', 's3Endpoint',
  'maxFileSizeMb', 'allowedExtensions', 'allowedMimeGroups', 'allowedMimeTypes', 'imageStripExif',
  // Platform ceiling (root tenant row) for app-signed machine download links, in seconds (default 86400).
  'storageLinkMaxTtlSeconds',
]);
export type StorageSettingKey = z.infer<typeof StorageSettingKeySchema>;
export const STORAGE_KEYS = StorageSettingKeySchema.options;
