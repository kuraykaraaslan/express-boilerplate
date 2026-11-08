import { z } from 'zod'

/**
 * Canonical per-tenant setting keys for `organization`. Centralised so the
 * services (runtime enforcement) and the settings page (admin UI) cannot drift
 * apart.
 *
 * Note what is NOT here: the legal-entity fields themselves. Those live in the
 * `organization_legal_entities` table and are *projected onto* the legacy
 * `invoice` / `terms_consent` / `payment` keys — see
 * organization.legal-entity.projection.ts. Storing them twice on purpose, in one
 * direction only, is the entire deduplication design.
 */
export const OrganizationSettingKeySchema = z.enum([
  /** Prefix used when a legal entity is created without an explicit code. */
  'organizationLegalEntityCodePrefix',
  /** Prefix used when a site is created without an explicit code. */
  'organizationSiteCodePrefix',
  /** Prefix used when a cost center is created without an explicit code. */
  'organizationCostCenterCodePrefix',
  /**
   * Write-through projection master switch. When 'false', saving the default
   * legal entity no longer rewrites the legacy invoice/terms/payment keys —
   * the escape hatch for a tenant that maintains those panels by hand.
   */
  'organizationProjectLegalEntityToSettings',
])
export type OrganizationSettingKey = z.infer<typeof OrganizationSettingKeySchema>

export const ORGANIZATION_KEYS = OrganizationSettingKeySchema.options

export const ORGANIZATION_SETTING_DEFAULTS: Record<OrganizationSettingKey, string> = {
  organizationLegalEntityCodePrefix: 'LE-',
  organizationSiteCodePrefix: 'SITE-',
  organizationCostCenterCodePrefix: 'CC-',
  organizationProjectLegalEntityToSettings: 'true',
}
