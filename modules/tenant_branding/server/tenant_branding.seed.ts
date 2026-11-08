import 'reflect-metadata'
import type { FindOptionsWhere } from 'typeorm'
import type { SeedContext } from '@kuraykaraaslan-labs/db/server/db.seed-contracts'
import { SEED_ADMIN_USER_ID } from '@kuraykaraaslan-labs/db/server/db.seed-contracts'
import { BrandingPreset } from './entities/branding_presets.entity'

type PresetDef = {
  name: string
  description: string | null
  values: Record<string, string>
  isActive: boolean
}

/** Hex palette used for filler presets (every entry is a valid 6-digit hex token). */
const FILLER_PALETTE = ['#0ea5e9', '#16a34a', '#d97706', '#9333ea', '#e11d48', '#0f766e'] as const

/**
 * Tenant-branding demo seed: named branding presets (`branding_presets`).
 *
 * The module's live branding is stored as settings, not rows, so the only
 * table to seed is the preset library. The presets are owned by the target
 * tenant (`ownerTenantId = ctx.tenantId`) and cover:
 *
 *  - Default: the full key set (name, tagline, both logos, favicon, both
 *    colours, wallpaper, legal links) with root-relative and https URLs.
 *  - Dark: dark-first palette with its own dark-logo and a small, safe
 *    `customCss` snippet.
 *  - High contrast: accessibility palette (black/yellow on white-ish) with
 *    3-digit hex tokens, the other accepted colour form.
 *  - Seasonal: a winter-holiday theme on top of the default look.
 *  - Edge cases: an inactive (retired) preset that `clonePreset` refuses, and
 *    an empty preset (`values: {}`) that carries no branding at all.
 *
 * Every value is valid for the module's write path: colours are `#rgb` /
 * `#rrggbb` hex, URLs are absolute http(s) on the reserved `example.com`
 * domain or root-relative (never `javascript:`/`data:`), and `customCss`
 * avoids every pattern the service blocks. No `customJs` is seeded. Only keys
 * in `TENANT_BRANDING_KEYS` are used (unknown keys would be dropped on write).
 *
 * The seed writes preset rows only. It does not apply any preset to a tenant,
 * so no settings are touched, no caches are invalidated and no audit entries
 * are emitted. Idempotent on `(ownerTenantId, name)`; filler presets are named
 * `Demo preset <n>`.
 */
export async function seedTenantBranding(ctx: SeedContext): Promise<void> {
  const { tenantId, foc, faker, refs } = ctx
  const createdByUserId = (refs.adminUserId as string | undefined) ?? SEED_ADMIN_USER_ID

  const defs: PresetDef[] = [
    {
      name: 'Default',
      description: 'The standard light look.',
      isActive: true,
      values: {
        brandName: 'Demo Workspace',
        brandTagline: 'Work, organised',
        brandLogoLight: '/brand/demo/logo-light.svg',
        brandLogoDark: '/brand/demo/logo-dark.svg',
        brandFavicon: '/brand/demo/favicon.ico',
        brandPrimaryColor: '#2563eb',
        brandSecondaryColor: '#64748b',
        authWallpaper: 'https://example.com/brand/demo/wallpaper.jpg',
        privacyPolicyUrl: 'https://example.com/privacy',
        termsOfServiceUrl: 'https://example.com/terms',
      },
    },
    {
      name: 'Dark',
      description: 'Dark-first palette with a light logo.',
      isActive: true,
      values: {
        brandName: 'Demo Workspace',
        brandTagline: 'Work, organised',
        brandLogoLight: '/brand/demo/logo-dark.svg',
        brandLogoDark: '/brand/demo/logo-dark.svg',
        brandFavicon: '/brand/demo/favicon-dark.ico',
        brandPrimaryColor: '#60a5fa',
        brandSecondaryColor: '#94a3b8',
        authWallpaper: 'https://example.com/brand/demo/wallpaper-dark.jpg',
        customCss: ':root { color-scheme: dark; }\nbody { background-color: #0b1220; }',
      },
    },
    {
      name: 'High contrast',
      description: 'Accessibility preset: maximum contrast, no wallpaper.',
      isActive: true,
      values: {
        brandName: 'Demo Workspace',
        brandLogoLight: '/brand/demo/logo-mono.svg',
        brandLogoDark: '/brand/demo/logo-mono.svg',
        brandPrimaryColor: '#000',
        brandSecondaryColor: '#ffd400',
        customCss: 'a { text-decoration: underline; }\n:focus-visible { outline: 3px solid #ffd400; }',
      },
    },
    {
      name: 'Winter holiday (seasonal)',
      description: 'Seasonal theme for the winter holidays.',
      isActive: true,
      values: {
        brandName: 'Demo Workspace',
        brandTagline: 'Season\'s greetings',
        brandLogoLight: 'https://example.com/brand/demo/logo-winter.svg',
        brandLogoDark: 'https://example.com/brand/demo/logo-winter-dark.svg',
        brandPrimaryColor: '#b91c1c',
        brandSecondaryColor: '#166534',
        authWallpaper: 'https://example.com/brand/demo/wallpaper-winter.jpg',
      },
    },
    {
      name: 'Retired legacy look',
      description: 'Switched off; applying it is refused.',
      isActive: false,
      values: { brandName: 'Demo Workspace (legacy)', brandPrimaryColor: '#7c3aed' },
    },
    // Edge: a preset carrying no branding values at all.
    { name: 'Empty preset', description: null, isActive: true, values: {} },
  ]

  const fillerCount = ctx.count(2)
  for (let i = 1; i <= fillerCount; i++) {
    defs.push({
      name: `Demo preset ${i}`,
      description: faker.sentence(6),
      isActive: faker.bool(0.8),
      values: {
        brandName: faker.company(),
        brandTagline: faker.words(3),
        brandPrimaryColor: faker.pick(FILLER_PALETTE),
        brandSecondaryColor: faker.pick(FILLER_PALETTE),
      },
    })
  }

  const repo = ctx.repo<BrandingPreset>(BrandingPreset)
  let defaultPresetId: string | undefined
  for (const def of defs) {
    const row = await foc(repo, { ownerTenantId: tenantId, name: def.name } as FindOptionsWhere<BrandingPreset>, {
      ownerTenantId: tenantId,
      name: def.name,
      description: def.description,
      values: def.values,
      isActive: def.isActive,
      createdByUserId,
    })
    if (def.name === 'Default') defaultPresetId = row.brandingPresetId
  }

  refs.brandingPresetId = defaultPresetId
  ctx.log(`tenant_branding: ${defs.length} branding presets`)
}
