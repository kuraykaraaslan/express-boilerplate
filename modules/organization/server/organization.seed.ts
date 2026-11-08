import 'reflect-metadata'
import type { FindOptionsWhere } from 'typeorm'
import type { SeedContext } from '@kuraykaraaslan-labs/db/server/db.seed-contracts'
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service'
import { LegalEntity } from './entities/organization_legal_entities.entity'
import { Site } from './entities/organization_sites.entity'
import { CostCenter } from './entities/organization_cost_centers.entity'
import { legalEntityFromSettings, IMPORTABLE_SETTING_KEYS } from './organization.legal-entity.projection'

/**
 * Demo data for `organization`: the shape of a plausible Turkish SME.
 *
 * Everything goes through `ctx.foc(repo, naturalKey, create)` with the
 * `{ tenantId, code }` natural key, so re-running the seed reuses rows instead
 * of duplicating them (the partial unique index would reject the duplicate
 * anyway — foc keeps the seed idempotent rather than merely safe).
 *
 * The legal entity is built with the same precedence `importFromSettings` uses:
 * if the tenant already filled in the legacy `invoice` / `terms_consent` /
 * `payment` identity keys, those win, and the demo values only fill the gaps.
 * Enabling `organization` on a configured tenant must never overwrite the name
 * on its invoices with "Örnek Teknoloji".
 *
 * `SeedContext` is imported as a TYPE ONLY — it is erased at compile time, so it
 * creates no activation edge and `seed` is deliberately absent from
 * `dependencies.requires` (see scripts/registry/imports.mjs, which also excludes
 * `*.seed.*` from the import graph outright).
 */
export async function seedOrganization(ctx: SeedContext): Promise<void> {
  const { tenantId, foc, refs } = ctx

  // ── Legal entity (adopts existing settings when present) ──────────────────
  // Same precedence as `LegalEntityService.importFromSettings`; a settings read
  // must never be able to fail a seed, so it degrades to "nothing to adopt".
  const existingSettings = await SettingService.getByKeys(tenantId, [
    ...IMPORTABLE_SETTING_KEYS,
  ]).catch(() => ({}) as Record<string, string>)
  const adopted = legalEntityFromSettings(existingSettings)

  const legalEntityRepo = ctx.repo<LegalEntity>(LegalEntity)
  const legalEntity = await foc(
    legalEntityRepo,
    { tenantId, code: 'LE-0001' } as FindOptionsWhere<LegalEntity>,
    {
      tenantId,
      code: 'LE-0001',
      legalName: adopted?.legalName ?? 'Örnek Teknoloji Anonim Şirketi',
      tradeName: adopted?.tradeName ?? 'Örnek Teknoloji',
      legalForm: 'A.Ş.',
      countryCode: adopted?.countryCode ?? 'TR',
      taxId: adopted?.taxId ?? '1234567890',
      taxOffice: adopted?.taxOffice ?? 'Maslak',
      vatNumber: adopted?.vatNumber,
      registrationNumber: adopted?.registrationNumber ?? '0123456789012345',
      addressJson: adopted?.addressJson ?? {
        line1: 'Maslak Mahallesi, Büyükdere Caddesi No: 255',
        line2: 'Nurol Plaza Kat: 12',
        city: 'İstanbul',
        region: 'Sarıyer',
        postalCode: '34398',
        countryCode: 'TR',
      },
      email: adopted?.email ?? 'muhasebe@ornekteknoloji.example',
      phone: adopted?.phone ?? '+12025550131',
      website: adopted?.website ?? 'https://ornekteknoloji.example',
      iban: adopted?.iban ?? 'TR000000000000000000000000',
      bankName: 'Örnek Bankası',
      isDefault: true,
      isActive: true,
    },
  )

  // ── Sites (single HQ) ─────────────────────────────────────────────────────
  const siteRepo = ctx.repo<Site>(Site)
  const hq = await foc(
    siteRepo,
    { tenantId, code: 'HQ' } as FindOptionsWhere<Site>,
    {
      tenantId,
      code: 'HQ',
      name: 'Genel Merkez',
      kind: 'OFFICE',
      legalEntityId: legalEntity.legalEntityId,
      addressJson: {
        line1: 'Maslak Mahallesi, Büyükdere Caddesi No: 255',
        city: 'İstanbul',
        region: 'Sarıyer',
        postalCode: '34398',
        countryCode: 'TR',
      },
      countryCode: 'TR',
      city: 'İstanbul',
      timezone: 'Europe/Istanbul',
      isHeadquarters: true,
      isActive: true,
    },
  )

  // ── Cost centers (one level of depth) ─────────────────────────────────────
  const costCenterRepo = ctx.repo<CostCenter>(CostCenter)
  const genelYonetim = await foc(
    costCenterRepo,
    { tenantId, code: 'GY' } as FindOptionsWhere<CostCenter>,
    { tenantId, code: 'GY', name: 'Genel Yönetim', path: '/GY', isActive: true },
  )
  const costCenterDefs = [
    { code: 'SAT', name: 'Satış' },
    { code: 'URT', name: 'Üretim' },
    { code: 'ARGE', name: 'Ar-Ge' },
  ]
  for (const def of costCenterDefs) {
    await foc(
      costCenterRepo,
      { tenantId, code: def.code } as FindOptionsWhere<CostCenter>,
      {
        tenantId,
        ...def,
        parentId: genelYonetim.costCenterId,
        path: `${genelYonetim.path}/${def.code}`,
        isActive: true,
      },
    )
  }

  // ── Publish references other seeds consume ────────────────────────────────
  refs.organizationLegalEntityId = legalEntity.legalEntityId
  refs.organizationSiteId = hq.siteId
  refs.organizationCostCenterId = genelYonetim.costCenterId

  ctx.log(
    `organization: 1 legal entity, 1 site, ${costCenterDefs.length + 1} cost centers for ${tenantId}`,
  )
}
