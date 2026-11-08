/**
 * Shared reference shapes for the CRM workspace and the platform cores it opens.
 *
 * These exist so that "which record is this hanging off?" has ONE spelling per
 * relationship kind across ~10 modules. The names are fixed by the CRM charter
 * (`docs/phases/03-crm/00-master-plan/README.md` §B.1) and a module may not
 * invent a synonym (`ownerType`, `subjectKind`, `refType`, …) for one of them.
 *
 * Note the deliberate asymmetry: `RelatedRef` keeps the names `activity` and
 * `tasks` already ship with, rather than being renamed for tidiness. A rename
 * would churn every caller and every stored `relatedType` value to buy nothing.
 *
 * `common` is AMBIENT, so importing this costs no `requires` edge.
 */

/** "who / which record is this ABOUT" — calendar occurrences, consent subjects. */
export type SubjectRef = { subjectType: string; subjectId: string }

/** "which record is this hung ON" — tag assignments, attachments. */
export type EntityRef = { entityType: string; entityId: string }

/** `activity` / `tasks`' existing spelling — PRESERVED, never renamed. */
export type RelatedRef = { relatedType: string; relatedId: string }

/** "which line did this derive FROM" — quote line → invoice line. */
export type SourceRef = { sourceType: string; sourceId: string }

/** Delivery target for an inbound message. */
export type TargetRef = { targetType: string; targetId: string }

/** A party on a call — matches the shape `telephony` already speaks. */
export type PartyRef = { partyType: 'COMPANY' | 'CONTACT' | 'LEAD'; partyId: string }

/**
 * Money on the wire. `amountMinor` is a STRING on purpose: it is a bigint of
 * minor units in the database, and JS `number` silently loses precision past
 * 2^53. Currency is ISO-4217 alpha-3.
 */
export type MoneyMinor = { amountMinor: string; currency: string }

/** Where a record sits on a tenant-defined pipeline. */
export type StageRef = { pipelineId: string; stageId: string }

/** Move history from one record onto another (lead → opportunity on convert). */
export type RelinkInput = { fromType: string; fromId: string; toType: string; toId: string }

/** Record-level visibility breadth resolved by `auth_abac:record_scope`. */
export type ScopeMode = 'OWN' | 'TEAM' | 'ALL'

/**
 * Subject-type values are an OPEN slug set, not a closed enum — the same call
 * the tree already makes for `seo`, `media_gallery` and `metering.unit`. A new
 * ERP module must be able to tag its own records without a commit to `tags`.
 *
 * The pattern is the contract; this list is the written register of values in
 * use, and a file introducing a new one adds it here.
 *
 * ## This is not the only subject axis, and the other one is NOT this shape
 *
 * `crm_assignment` addresses its own subject through a free-form
 * `varchar(64)` (`crm_assignment_runs.subjectType`) carrying dotted values like
 * `'crm_lead.Lead'`. That axis answers "who owns this record", records its own
 * decision ledger, and this pattern does not reach it. Do not "unify" the two:
 * the dotted values are load-bearing in that module's request keys, so
 * rewriting them would silently re-run assignments that had already been made.
 *
 * The pattern DOES reach `activity`, `tasks` and `tags` — and it is enforced
 * inside their services, not only at their routes, so a value that fails it
 * cannot be persisted by any path.
 */
export const ENTITY_TYPE_PATTERN = /^[A-Z][A-Z0-9_]{2,39}$/

export const KNOWN_ENTITY_TYPES = [
  'CRM_LEAD', 'CRM_OPPORTUNITY', 'QUOTE', 'QUOTE_LINE',
  'CONTACT_COMPANY', 'CONTACT_CONTACT', 'SUPPORT_TICKET', 'FORM_SUBMISSION',
  'ORDER', 'INVOICE', 'PROJECT', 'EMPLOYEE', 'TEAM', 'USER',
] as const

export type KnownEntityType = (typeof KNOWN_ENTITY_TYPES)[number]

/** True when `value` is a syntactically valid subject type. */
export function isEntityType(value: string): boolean {
  return ENTITY_TYPE_PATTERN.test(value)
}
