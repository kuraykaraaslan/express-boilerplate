import { z } from 'zod'

export const TenantBrandingSchema = z.object({
  brandName: z.string().optional(),
  brandTagline: z.string().optional(),
  brandLogoLight: z.string().optional(),
  brandLogoDark: z.string().optional(),
  brandIconLight: z.string().optional(),
  brandIconDark: z.string().optional(),
  brandFavicon: z.string().optional(),
  brandPrimaryColor: z.string().optional(),
  brandSecondaryColor: z.string().optional(),
  authWallpaper: z.string().optional(),
  customCss: z.string().max(50_000).optional(),
  customJs: z.string().max(50_000).optional(),
  privacyPolicyUrl: z.string().optional(),
  termsOfServiceUrl: z.string().optional(),
})
export type TenantBranding = z.infer<typeof TenantBrandingSchema>

/**
 * What a write may carry (tenant_branding.07, fixed 2026-10-20): every key is bounded, so a 100 000-character name or URL is a 400
 * and never reaches the page chrome or the mail brand. Reads keep the lenient `TenantBrandingSchema`, so a row stored before the
 * bounds still loads.
 */
const url = z.string().max(2048)
export const TenantBrandingInputSchema = z.object({
  brandName: z.string().max(200).optional(),
  brandTagline: z.string().max(500).optional(),
  brandLogoLight: url.optional(),
  brandLogoDark: url.optional(),
  brandIconLight: url.optional(),
  brandIconDark: url.optional(),
  brandFavicon: url.optional(),
  // Bounded only for size here; the hex rule itself is the service's (assertHexColor, a 422 like every other content rule).
  brandPrimaryColor: z.string().max(200).optional(),
  brandSecondaryColor: z.string().max(200).optional(),
  authWallpaper: url.optional(),
  customCss: z.string().max(50_000).optional(),
  customJs: z.string().max(50_000).optional(),
  privacyPolicyUrl: url.optional(),
  termsOfServiceUrl: url.optional(),
})

export const TenantBrandingStateSchema = z.object({
  tenantId: z.string().nullable(),
  branding: TenantBrandingSchema,
  isLoading: z.boolean(),
  error: z.string().nullable(),
})
export type TenantBrandingState = z.infer<typeof TenantBrandingStateSchema>
