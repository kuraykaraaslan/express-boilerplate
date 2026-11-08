import { z } from 'zod';

// Request bodies and queries of the editor's API (docs/phases/54-menu-editor, 03). The menu spec itself is checked by
// MenuSpecSchema in the service; here only the envelopes.

/** `PUT /api/shell-menu/draft`: the whole draft, and the etag the editor last saw (null = there was no draft). */
export const SaveDraftBodySchema = z.object({
  spec: z.unknown(),
  labels: z.unknown().optional(),
  etag: z.string().max(64).nullable(),
}).strict();

export const PublishBodySchema = z.object({
  baseRevision: z.number().int().min(0).optional(),
  note: z.string().max(280).nullable().optional(),
}).strict();

export const ImportBodySchema = z.object({
  file: z.unknown(),
  target: z.enum(['draft', 'publish']),
  write: z.boolean().default(false),
  replace: z.boolean().default(false),
  note: z.string().max(280).nullable().optional(),
}).strict();

export const RevisionParamSchema = z.coerce.number().int().min(1).max(1_000_000);

export const PageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const LinkTargetsQuerySchema = z.object({
  kind: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
  q: z.string().max(100).default(''),
});

export const SuggestQuerySchema = z.object({
  en: z.string().trim().min(1).max(60),
  languages: z.string().max(400).optional(),
});

/** The import body is a whole menu file: at most this many bytes. */
export const IMPORT_MAX_BYTES = 512 * 1024;
