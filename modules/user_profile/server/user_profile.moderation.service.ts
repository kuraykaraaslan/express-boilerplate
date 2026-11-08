import axios from 'axios'
import Logger from '@kuraykaraaslan-labs/logger'
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service'

export interface ModerationResult {
  flagged: boolean
  score: number
  categories: string[]
  provider: string
}

/**
 * Real, per-tenant-configurable image moderation for avatars / header images.
 * No mock: when a tenant wires a provider's credentials the image URL is sent to
 * the real moderation API; unconfigured → returns null (moderation simply does
 * not run, the upload is allowed). Supports Sightengine (the most common nudity
 * API) and any generic HTTP endpoint that returns a flagged/score shape.
 *
 * Settings (per tenant):
 *   avatarModerationProvider  'sightengine' | 'generic'
 *   avatarModerationUrl       generic endpoint URL (generic provider)
 *   avatarModerationApiKey    Bearer key (generic) / api_secret (sightengine)
 *   avatarModerationApiUser   api_user (sightengine)
 *   avatarModerationThreshold flag threshold 0..1 (default 0.6)
 */
/** The flag threshold the settings page offers: a score in (0, 1]. Anything else (0, negative, above 1, not a number) -> 0.6. */
export const DEFAULT_MODERATION_THRESHOLD = 0.6
export function sanitizeModerationThreshold(raw: string | null | undefined): number {
  const v = (raw ?? '').trim()
  if (!/^\d*\.?\d+$/.test(v)) return DEFAULT_MODERATION_THRESHOLD
  const n = Number(v)
  return n > 0 && n <= 1 ? n : DEFAULT_MODERATION_THRESHOLD
}

export default class UserProfileModerationService {

  private static async config(tenantId: string) {
    const s = await SettingService.getByKeys(tenantId, [
      'avatarModerationProvider', 'avatarModerationUrl',
      'avatarModerationApiKey', 'avatarModerationApiUser', 'avatarModerationThreshold',
    ]).catch(() => ({} as Record<string, string | null>))
    return {
      provider: (s.avatarModerationProvider ?? '').toLowerCase(),
      url: s.avatarModerationUrl,
      apiKey: s.avatarModerationApiKey,
      apiUser: s.avatarModerationApiUser,
      // 2026-10-27: a score in (0, 1]; a value above 1 used to switch flagging off without a word, it now reads as 0.6.
      threshold: sanitizeModerationThreshold(s.avatarModerationThreshold),
    }
  }

  static async isConfigured(tenantId: string): Promise<boolean> {
    const c = await this.config(tenantId)
    if (c.provider === 'sightengine') return Boolean(c.apiUser && c.apiKey)
    if (c.provider === 'generic') return Boolean(c.url && c.apiKey)
    return false
  }

  /**
   * Moderate an image by URL. Returns null when moderation is not configured
   * (skip) or the provider call fails (fail-open — never block an upload on a
   * provider outage). A non-null result with `flagged: true` means reject.
   */
  static async moderateImageUrl(tenantId: string, imageUrl: string): Promise<ModerationResult | null> {
    const c = await this.config(tenantId)
    try {
      if (c.provider === 'sightengine' && c.apiUser && c.apiKey) {
        const res = await axios.get('https://api.sightengine.com/1.0/check.json', {
          params: { url: imageUrl, models: 'nudity-2.1,offensive', api_user: c.apiUser, api_secret: c.apiKey },
          timeout: 10000,
        })
        const n = res.data?.nudity ?? {}
        const offensive = res.data?.offensive?.prob ?? 0
        // nudity-2.1 returns sexual_activity/sexual_display/erotica + 'none'.
        const score = Math.max(
          Number(n.sexual_activity) || 0, Number(n.sexual_display) || 0,
          Number(n.erotica) || 0, Number(offensive) || 0,
        )
        const categories: string[] = []
        if ((Number(n.sexual_activity) || 0) >= c.threshold) categories.push('sexual_activity')
        if ((Number(n.sexual_display) || 0) >= c.threshold) categories.push('sexual_display')
        if ((Number(n.erotica) || 0) >= c.threshold) categories.push('erotica')
        if ((Number(offensive) || 0) >= c.threshold) categories.push('offensive')
        return { flagged: score >= c.threshold, score, categories, provider: 'sightengine' }
      }

      if (c.provider === 'generic' && c.url && c.apiKey) {
        const res = await axios.post(c.url, { url: imageUrl }, {
          headers: { Authorization: `Bearer ${c.apiKey}`, 'Content-Type': 'application/json' },
          timeout: 10000,
        })
        const data = res.data ?? {}
        const score = Number(data.score ?? data.probability ?? data.nudity ?? 0) || 0
        const flagged = typeof data.flagged === 'boolean' ? data.flagged : score >= c.threshold
        const categories: string[] = Array.isArray(data.categories) ? data.categories : (Array.isArray(data.labels) ? data.labels : [])
        return { flagged, score, categories, provider: 'generic' }
      }
    } catch (err) {
      Logger.warn(`[user_profile] avatar moderation failed: ${err instanceof Error ? err.message : String(err)}`)
      return null // fail-open
    }
    return null // not configured → skip
  }
}
