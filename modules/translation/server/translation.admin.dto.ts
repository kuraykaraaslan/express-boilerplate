import { z } from 'zod';
import { KeySchema, LocaleSchema, ModuleIdSchema } from './translation.dto';
import type { TranslationPlatform } from './translation.types';

// Request shapes of the system-level admin API (root super-admin, GLOBAL scope).
// The platform is spelled out as `shared` instead of null so it survives a query string.

export const AdminPlatformSchema = z.enum(['shared', 'web', 'mobile']);
export type AdminPlatform = z.infer<typeof AdminPlatformSchema>;

export const toRowPlatform = (p: AdminPlatform): TranslationPlatform | null => (p === 'shared' ? null : p);
export const toAdminPlatform = (p: TranslationPlatform | null): AdminPlatform => p ?? 'shared';

/** Most rows one save, delete or import may carry. */
export const MAX_BATCH = 1000;
/** Most keys one import file may carry (a whole language is ~5-10k today). */
export const MAX_IMPORT_KEYS = 20_000;

/** GET /api/translations: every key of one module in one language. */
export const ModuleQuerySchema = z.object({
  locale: LocaleSchema,
  module: ModuleIdSchema,
  q: z.string().trim().max(200).optional(),
});

/** GET /api/translations/summary */
export const SummaryQuerySchema = z.object({ locale: LocaleSchema });

const AdminRef = {
  locale: LocaleSchema,
  module: ModuleIdSchema,
  platform: AdminPlatformSchema,
  key: KeySchema,
};

/** PUT /api/translations */
export const SaveBodySchema = z.object({
  entries: z.array(z.object({ ...AdminRef, value: z.string() })).min(1).max(MAX_BATCH),
});

/** DELETE /api/translations */
export const RemoveBodySchema = z.object({
  refs: z.array(z.object(AdminRef)).min(1).max(MAX_BATCH),
});

/**
 * POST /api/translations/import: a flat `{ "<module>.<area>.<slug>": "text" }` map, the shape of
 * `modules/<id>/dictionaries/en.json` and of the export. Without `write: true` nothing is stored.
 */
export const ImportBodySchema = z.object({
  locale: LocaleSchema,
  platform: AdminPlatformSchema.default('shared'),
  messages: z.record(z.string(), z.string()).refine((m) => Object.keys(m).length <= MAX_IMPORT_KEYS, {
    message: `At most ${MAX_IMPORT_KEYS} keys per import`,
  }),
  write: z.boolean().default(false),
});

/** GET /api/translations/export */
export const ExportQuerySchema = z.object({
  locale: LocaleSchema,
  platform: AdminPlatformSchema.default('shared'),
});
