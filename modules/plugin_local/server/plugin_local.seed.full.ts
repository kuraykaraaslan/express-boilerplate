import 'reflect-metadata'
import { createHash } from 'node:crypto'
import type { SeedContext } from '@kuraykaraaslan-labs/db/server/db.seed-contracts'
import { LocalPlugin } from './entities/local_plugin.entity'
import { LocalPluginVersion } from './entities/local_plugin_version.entity'

/** Every seeded plugin name starts with this, so a report can filter the lane out. */
export const SYNTHETIC_PLUGIN_PREFIX = '[synthetic] '
export const SYNTHETIC_SCOPED_NAME = '@synthetic/demo-gateway'

const DAY = 86_400_000
const ANCHOR = Date.UTC(2026, 5, 1, 9, 0, 0)
const at = (daysFromAnchor: number) => new Date(ANCHOR + daysFromAnchor * DAY)

/** Deterministic uuid-shaped id from a name, so a re-run finds its own rows. */
function uuidFrom(name: string): string {
  const h = createHash('sha256').update(`seed-plugin-local:${name}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}

/**
 * Full-load seed for `plugin_local` (guarded test database only).
 *
 * Why this is NOT in the default seed (`plugin_local` is exempt as `runtime-state`): a row is an operator's upload, a bundle that was stored,
 * scanned, checksummed and, for a running version, approved. A fabricated row would name a bundle that never existed.
 *
 * Why these rows are inert: the plugin's name starts with `[synthetic]`, its bundle key points at no stored file, and NO install is seeded, so
 * nothing ever resolves or runs them (an install would also fail the checksum re-check, since no bytes exist). They cover the version states the
 * console shows: approved (with a grant), pending approval, and yanked.
 *
 * Idempotent: every row is keyed on a natural key or a name-derived id.
 */
export async function seedPluginLocalFull(ctx: SeedContext): Promise<void> {
  const { foc, systemRepo } = ctx
  const manifest = (version: string) => JSON.stringify({
    id: SYNTHETIC_SCOPED_NAME, name: `${SYNTHETIC_PLUGIN_PREFIX}Demo gateway`, version,
    sandbox: { runtime: 'isolated', capabilities: ['http', 'secrets'], httpAllowlist: ['api.synthetic.invalid'] },
    extensions: [{ point: 'payment:gateway', key: 'synthetic' }],
  })
  const plugin = await foc(systemRepo(LocalPlugin), { scopedName: SYNTHETIC_SCOPED_NAME }, {
    pluginId: uuidFrom('plugin'),
    scopedName: SYNTHETIC_SCOPED_NAME,
    name: `${SYNTHETIC_PLUGIN_PREFIX}Demo gateway`,
    status: 'active',
    currentVersionId: uuidFrom('version:1.1.0'),
    createdBy: null,
  })
  const versions: Array<{ version: string; approved: boolean; yanked: boolean }> = [
    { version: '1.0.0', approved: true, yanked: true },
    { version: '1.1.0', approved: true, yanked: false },
    { version: '1.2.0', approved: false, yanked: false },
  ]
  for (const v of versions) {
    await foc(systemRepo(LocalPluginVersion), { pluginId: plugin.pluginId, version: v.version }, {
      versionId: uuidFrom(`version:${v.version}`),
      pluginId: plugin.pluginId,
      version: v.version,
      manifestJson: manifest(v.version),
      sandboxJson: v.approved ? JSON.stringify({ capabilities: ['http', 'secrets'], httpAllowlist: ['api.synthetic.invalid'], limits: {} }) : null,
      bundleKey: `plugin-bundles/synthetic/${v.version}.js`,
      bundleUploadedFileId: null,
      bundleSha256: createHash('sha256').update(`synthetic bundle ${v.version}`).digest('hex'),
      signature: null,
      signerKid: null,
      signatureVerified: false,
      uploadedBy: null,
      approvedBy: null,
      approvedAt: v.approved ? at(-20) : null,
      yankedAt: v.yanked ? at(-10) : null,
      yankedReason: v.yanked ? 'Superseded by 1.1.0 (synthetic)' : null,
    })
  }
}
