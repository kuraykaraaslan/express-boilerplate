import { z } from 'zod'
import { patchSchema } from '@kuraykaraaslan-labs/common/server/zod-patch'
import { DataBindingSchema } from './dashboard.dto'
import { CategoryKeySchema, DEFAULT_WIDGET_CATEGORY } from './widget-category'
import { isStepKey } from './tenant-template.schema'

/** Widget type: an OPEN slug. The spec's 15 "widget types" are seeded widgets. */
export const WidgetTypeSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_.-]*$/, 'Invalid widget type')

/**
 * A dispatch key, not a taxonomy — each value is a renderer we ship. Closed on
 * purpose; see the CHECK in migration 091 and the entity comment for why this is
 * not the closed-enum anti-pattern the audit's MIS-05/06 is about.
 */
export const RenderTierEnum = z.enum(['component', 'template', 'iframe'])
export const WidgetVisibilityEnum = z.enum(['TENANT', 'PRIVATE'])

/**
 * A FieldSchema map, kept loose: the field vocabulary is common's to define. A field key is never a prototype
 * name nor a `$` key (a platform namespace, which settings never read as a field): a publish turns field keys
 * into the migration ops of the widget's template line, and the widget import refuses those keys in an op.
 */
const SchemaMap = z.record(z.string().refine(isStepKey, 'A field key cannot be __proto__, constructor, prototype or start with $'), z.record(z.string(), z.unknown()))

/**
 * An abstract data slot (phase 4b §3.5): the widget says "I need a series",
 * never WHICH series — that binding lives on the placement. Client-authorable
 * because it names no source, no query and no URL.
 */
export const DataSlotSchema = z
  .object({
    key: z.string().min(1).max(60).regex(/^[a-z0-9][a-z0-9_-]*$/i, 'Invalid slot key'),
    label: z.string().min(1).max(120),
    shape: z.enum(['scalar', 'series', 'table', 'record']),
    required: z.boolean().default(false),
    /** May be bound to several sources (18.3); the extras live under `<key>#2`, `<key>#3`... in the binding. */
    repeatable: z.boolean().optional(),
  })
  .strict()

export const DataSpecSchema = z.array(DataSlotSchema).max(6)
  .refine((slots) => new Set(slots.map((s) => s.key)).size === slots.length, {
    message: 'Slot keys must be unique',
  })

export const CreateWidgetDTO = z
  .object({
    type: WidgetTypeSchema,
    label: z.string().min(1).max(120),
    // Shape only; membership in the category registry is checked by the route
    // (it needs the tenant's enabled modules), see `widget-category.registry.ts`.
    category: CategoryKeySchema.default(DEFAULT_WIDGET_CATEGORY),
    description: z.string().max(2000).nullable().optional(),
    renderTier: RenderTierEnum.default('template'),
    template: z.string().max(200_000).default(''),
    schema: SchemaMap.default({}),
    defaultProps: z.record(z.string(), z.unknown()).default({}),
    dataSpec: DataSpecSchema.nullable().optional(),
    visibility: WidgetVisibilityEnum.default('TENANT'),
    defaultW: z.number().int().min(1).max(12).default(6),
    defaultH: z.number().int().min(1).max(48).default(4),
    icon: z.string().max(64).nullable().optional(),
    tags: z.array(z.string().max(32)).max(20).nullable().optional(),
    /** Roles that may place and see this widget (empty = everyone; `widget-roles.acl.ts`, enforced since owner decision 2026-10-16). Permissions (`auth_abac`) and `widget-placement.acl` still apply on top. */
    allowedRoles: z.array(z.string().max(32)).max(10).nullable().optional(),
    /**
     * K12: a no-code preset. Names a PLATFORM builtin (`db:<uuid>`, resolved
     * server-side against `widget.root-catalog.ts` — never a bare uuid, so the
     * same `WidgetRefSchema`-style prefix discipline applies here too) whose
     * `renderTier`/`componentId`/`schema`/`dataSpec` are copied onto this row
     * BY THE SERVICE, not taken from this DTO: `componentId` stays a first-party
     * path no client names directly, and a preset reaching for the base by
     * reference rather than typing the same rule out a second time is exactly
     * how that stays true for it too.
     */
    baseWidgetRef: z.string().regex(/^db:[0-9a-f-]{36}$/i, 'Invalid base widget reference').nullable().optional(),
    /** K12: what a fresh placement of this widget starts bound to. A pointer, not a credential — see `DataBindingSchema`. */
    defaultDataBinding: DataBindingSchema.nullable().optional(),
  })
  // `componentId` and `frameListingId` are NOT accepted from a client: tier 1
  // points at first-party code and tier 3 at an installed listing, so letting a
  // request name either would let a tenant mount arbitrary shipped components.
  .strict()

export const UpdateWidgetDTO = patchSchema(CreateWidgetDTO).extend({
  expectedRevision: z.number().int().min(0).optional(),
}).strict()

/** A settings field key the author says was renamed since the last publish (21.8). */
const FieldKeySchema = z.string().min(1).max(120)

export const PublishWidgetDTO = z
  .object({
    changelog: z.string().max(2000).nullable().optional(),
    /** 21.8: "this field used to be called…", so existing placements keep their value under the new key. */
    renames: z.array(z.object({ from: FieldKeySchema, to: FieldKeySchema }).strict()).max(100).optional(),
    /** 21.8: a changed default keeps the old value on existing placements (default) or reaches them. */
    keepOldDefaults: z.boolean().optional(),
  })
  .strict()

/**
 * The `…/transition` body, parsed once: a strict union on `action`. Only `publish` takes the publish fields; every
 * other move is `{ action }` alone, so an unknown top-level key (a `tenantId`, an `ownerUserId`, `renames` on an
 * archive) is a 400 like on every other dashboard DTO route instead of being silently dropped.
 */
export const WidgetTransitionDTO = z.discriminatedUnion('action', [
  PublishWidgetDTO.extend({ action: z.literal('publish') }).strict(),
  z.object({ action: z.enum(['unpublish', 'archive', 'restore']) }).strict(),
])

export type CreateWidgetInput = z.infer<typeof CreateWidgetDTO>
export type UpdateWidgetInput = z.infer<typeof UpdateWidgetDTO>
