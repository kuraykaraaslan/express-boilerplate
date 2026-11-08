import { z } from 'zod';
import { listFilter, listQuerySchema } from '@kuraykaraaslan-labs/common/server/common.list-query';
import {
  AnnouncementChannelEnum, AnnouncementKindEnum, AnnouncementRoleEnum, AnnouncementSeverityEnum, AnnouncementStatusEnum,
} from './announcement.enums';
import AnnouncementMessages from './announcement.messages';

/** A language tag of the content map: `en`, `tr`, `pt-BR`. */
export const LanguageTagSchema = z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/, 'A language tag such as en or pt-BR');

export const AnnouncementTextSchema = z.object({
  title: z.string().trim().max(200),
  body: z.string().max(10_000).default(''),
});

/**
 * Where to read more: an internal app path (`/status`, the bell opens it inside the app) or an https URL. Never
 * `javascript:`, `data:` or a protocol-relative `//host`. No whitespace, control character or backslash anywhere, as
 * for the body's links (announcement.markdown `safeHref`): a browser drops a tab or a line break inside a URL, so
 * `/<TAB>/evil.example` passed as an app path and opened `//evil.example` in the same tab, shown as an internal link.
 */
export const LinkUrlSchema = z.string().trim().max(2000).refine(
  (v) => !/[\s\u0000-\u001f\u007f\\]/.test(v)
    && ((v.startsWith('/') && !v.startsWith('//')) || /^https:\/\/[^\s/$.?#][^\s]*$/i.test(v)),
  AnnouncementMessages.LINK_INVALID,
);

/** Who gets it (D18): every tenant or chosen ones, roles, plans and editions. A tenant sender's list is replaced by its own tenant. */
export const AnnouncementAudienceSchema = z.object({
  tenantIds: z.array(z.string().uuid()).max(1000).nullable().default(null),
  roles: z.array(AnnouncementRoleEnum).max(3).default([]),
  plans: z.array(z.string().min(1).max(100)).max(100).default([]),
  editions: z.array(z.string().min(1).max(40)).max(10).default([]),
});
export type AnnouncementAudienceInput = z.infer<typeof AnnouncementAudienceSchema>;

const contentShape = z.record(LanguageTagSchema, AnnouncementTextSchema).refine((c) => Object.keys(c).length > 0 && Object.keys(c).length <= 20, 'Between 1 and 20 languages');

const base = {
  severity: AnnouncementSeverityEnum.default('info'),
  content: contentShape,
  defaultLanguage: LanguageTagSchema.default('en'),
  linkUrl: LinkUrlSchema.nullable().optional(),
  audience: AnnouncementAudienceSchema.default({ tenantIds: null, roles: [], plans: [], editions: [] }),
  channels: z.array(AnnouncementChannelEnum).min(1).max(7).transform((c) => [...new Set(c)]),
  sendAt: z.coerce.date().nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
};

/** The default language must carry a title: it is what every other language falls back to (D19). */
const hasDefaultTitle = (v: { content?: Record<string, { title: string }>; defaultLanguage?: string }) =>
  !v.content || !v.defaultLanguage || Boolean(v.content[v.defaultLanguage]?.title);

/**
 * POST /api/announcements. `send`: `now` sends at once (after the confirm), `schedule` at `sendAt`, `draft` keeps it.
 */
export const CreateAnnouncementDTO = z.object({
  ...base,
  send: z.enum(['draft', 'schedule', 'now']).default('draft'),
}).refine(hasDefaultTitle, { message: AnnouncementMessages.CONTENT_MISSING_DEFAULT, path: ['content'] })
  .refine((v) => v.send !== 'schedule' || Boolean(v.sendAt), { message: 'A scheduled announcement needs a send time', path: ['sendAt'] });
export type CreateAnnouncementDTO = z.infer<typeof CreateAnnouncementDTO>;

/** PATCH /api/announcements/[id]: a draft or a scheduled one. */
export const UpdateAnnouncementDTO = z.object({
  severity: base.severity.optional(),
  content: contentShape.optional(),
  defaultLanguage: LanguageTagSchema.optional(),
  linkUrl: base.linkUrl,
  audience: AnnouncementAudienceSchema.optional(),
  channels: base.channels.optional(),
  sendAt: base.sendAt,
  expiresAt: base.expiresAt,
}).refine(hasDefaultTitle, { message: AnnouncementMessages.CONTENT_MISSING_DEFAULT, path: ['content'] });
export type UpdateAnnouncementDTO = z.infer<typeof UpdateAnnouncementDTO>;

/** POST /api/announcements/[id]/send: now, or at `sendAt`. */
export const SendAnnouncementDTO = z.object({
  sendAt: z.coerce.date().nullable().optional(),
});
export type SendAnnouncementDTO = z.infer<typeof SendAnnouncementDTO>;

/** POST /api/announcements/audience: how many people an audience reaches (the confirm's number). */
export const AudienceCountDTO = z.object({
  audience: AnnouncementAudienceSchema,
  channels: z.array(AnnouncementChannelEnum).max(7).default([]),
});
export type AudienceCountDTO = z.infer<typeof AudienceCountDTO>;

/** POST /api/announcements/live/[id]: what the person did with it in the shell. */
export const ReceiptActionDTO = z.object({
  action: z.enum(['seen', 'acknowledge', 'dismiss']),
});
export type ReceiptActionDTO = z.infer<typeof ReceiptActionDTO>;

/** Public sort fields of the history → entity properties (phase 43 list contract). */
export const ANNOUNCEMENT_SORTABLE = {
  createdAt: 'createdAt',
  sendAt: 'sendAt',
  sentAt: 'sentAt',
  status: 'status',
  severity: 'severity',
  kind: 'kind',
} as const;

/** The history: newest first; statuses, kinds and severities; a created-day range; a search over the default title. */
export const GetAnnouncementsQuery = listQuerySchema({
  sortable: ANNOUNCEMENT_SORTABLE,
  defaultSort: 'createdAt:desc',
  filters: {
    status: listFilter.oneOf(AnnouncementStatusEnum.options),
    kind: listFilter.oneOf(AnnouncementKindEnum.options),
    severity: listFilter.oneOf(AnnouncementSeverityEnum.options),
    createdFrom: listFilter.day(),
    createdTo: listFilter.day(),
  },
});
export type GetAnnouncementsQuery = z.infer<typeof GetAnnouncementsQuery>;

/** What the API answers for one announcement. */
export const AnnouncementViewSchema = z.object({
  announcementId: z.string().uuid(),
  tenantId: z.string().uuid().nullable(),
  kind: AnnouncementKindEnum,
  status: AnnouncementStatusEnum,
  severity: AnnouncementSeverityEnum,
  content: z.record(z.string(), z.object({ title: z.string(), body: z.string() })),
  defaultLanguage: z.string(),
  linkUrl: z.string().nullable(),
  audience: z.object({
    tenantIds: z.array(z.string()).nullable(),
    roles: z.array(z.string()),
    plans: z.array(z.string()),
    editions: z.array(z.string()),
  }),
  channels: z.array(AnnouncementChannelEnum),
  sendAt: z.date().nullable(),
  expiresAt: z.date().nullable(),
  sentAt: z.date().nullable(),
  withdrawnAt: z.date().nullable(),
  windowId: z.string().uuid().nullable(),
  stage: z.string().nullable(),
  edited: z.boolean(),
  stats: z.object({
    recipients: z.number().optional(),
    delivered: z.record(z.string(), z.number()).optional(),
    failed: z.record(z.string(), z.number()).optional(),
    mailCapped: z.boolean().optional(),
    restarts: z.number().optional(),
    failure: z.object({ reason: z.string(), at: z.string(), restarts: z.number() }).optional(),
  }).passthrough(),
  createdByUserId: z.string().uuid().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type AnnouncementView = z.infer<typeof AnnouncementViewSchema>;
