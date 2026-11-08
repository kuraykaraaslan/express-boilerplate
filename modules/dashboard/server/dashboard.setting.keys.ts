// No server imports: the settings page (a client component) reads these keys. zod is a plain library.
import { z } from 'zod'

/**
 * Tenant settings this module reads, each with its reader.
 */
export const DASHBOARD_SETTING_KEYS = {
  /**
   * The sites a `content.embed` card may frame (decision 2026-10-17 #9): one hostname per line (or comma
   * separated), `*.example.com` for its subdomains. Empty, the default, allows no embed: an embed is a
   * third-party page shown inside the admin, and the tenant decides which. Read by `getEmbedHosts`, which
   * serves `GET …/dashboard/embed-hosts` (the cards) and the placement save check (`embedHostIssue`).
   */
  EMBED_HOSTS: 'dashboardEmbedHosts',
} as const

/** The manifest's `settings` entry points here. */
export const DASHBOARD_KEYS = Object.values(DASHBOARD_SETTING_KEYS)

/**
 * SG-04 (2026-10-27): the same keys as an enum, the declaration the settings guard's owner list mirrors
 * (tenant_setting.key-owners.ts, tests/tenant_setting.key-owners.test.ts): the generic settings API needs
 * `dashboard.settings.read` / `.update` for them.
 */
export const DashboardSettingKeySchema = z.enum([
  'dashboardEmbedHosts',
])
