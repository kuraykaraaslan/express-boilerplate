import { z } from 'zod'

/**
 * The catalogs `organization` owns. This is the vocabulary every *other* module
 * uses to talk about an organization row without importing this module's
 * entities — the lookup service keys its labels by it, and the
 * `organization:reference_check` extension point passes it to contributors.
 *
 * `TEAM` joined the set when teams landed: `crm_opportunities.teamId`,
 * `pipeline_stages.teamId` and `crm_assignment_rules.teamId` all hold a bare
 * team uuid, so deleting a team has to ask them first. The arrow points INWARD
 * — CRM contributes the count, `organization` imports nothing from CRM.
 */
export const OrganizationRefKindEnum = z.enum([
  'LEGAL_ENTITY',
  'SITE',
  'COST_CENTER',
  'TEAM',
])
export type OrganizationRefKind = z.infer<typeof OrganizationRefKindEnum>

/**
 * Suggested `Site.kind` values. The COLUMN is deliberately free-form varchar —
 * this list only drives the admin picker, so a consumer can introduce DEPOT
 * without a migration here.
 */
export const SITE_KINDS = ['OFFICE', 'BRANCH', 'WAREHOUSE', 'PLANT', 'STORE', 'REMOTE'] as const
export type SiteKind = (typeof SITE_KINDS)[number]
