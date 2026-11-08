import 'reflect-metadata'
import type { FindOptionsWhere } from 'typeorm'
import type { SeedContext } from '@kuraykaraaslan-labs/db/server/db.seed-contracts'
import { Install } from './entities/install.entity'
import { ModuleAvailability } from './entities/module_availability.entity'
import { ModulePolicy } from './entities/module_policy.entity'
import { Setting } from '@kuraykaraaslan-labs/tenant_setting/server/entities/setting.entity'

/**
 * The tenant that owns every seeded ledger row. SYNTHETIC: it is neither PLATFORM nor ACME
 * and exists in no `tenants` table, so no real tenant's modules or plugins are affected.
 */
export const SYNTHETIC_INSTALL_TENANT_ID = 'c0000000-0000-4000-8000-0000000000e1'

/** Synthetic plugin listing ids: no marketplace listing exists for any of them. */
const LISTING = {
  release: 'c0000000-0000-4000-8000-00000000e101',
  paused: 'c0000000-0000-4000-8000-00000000e102',
  testChannel: 'c0000000-0000-4000-8000-00000000e103',
} as const
/** Synthetic `PublishedModuleVersion.versionId`s, again with no row behind them. */
const VERSION = {
  release: 'c0000000-0000-4000-8000-00000000e201',
  paused: 'c0000000-0000-4000-8000-00000000e202',
  testChannel: 'c0000000-0000-4000-8000-00000000e203',
} as const

const DAY = 24 * 60 * 60 * 1000
const ANCHOR = Date.UTC(2026, 3, 1, 9, 0, 0)
const at = (daysBeforeAnchor: number) => new Date(ANCHOR - daysBeforeAnchor * DAY)

/**
 * Full-load seed for `module_lifecycle`: the install ledger (`installs`).
 *
 * Why this is NOT in the default seed (`module_lifecycle` is exempt as `runtime-state`):
 * real rows are written by `install()` / `setActive()` / the plugin install service, which
 * also run the module's hooks, write the `module.<id>.enabled` projection and audit the
 * change. A demo row without that history would lie about what was installed. The
 * full-load lane (guarded test database only) still needs the table filled.
 *
 * How this stays harmless:
 *  - historic records only: the rows are written straight through the repository, no hook
 *    runs, no service, no audit entry, no job;
 *  - they belong to a synthetic tenant (see {@link SYNTHETIC_INSTALL_TENANT_ID}), not ACME,
 *    so no real tenant's module gate (`getEnabledModuleIds`), plugin broker, auto-update or
 *    licence-expiry job sees them. The plugin listing/version ids exist nowhere.
 *  - `scripts/verify-install-ledger.mjs` compares the ledger with its settings projections
 *    (`module.<id>.enabled`, `plugin.community.<id>.{version,active,channel}`). Those
 *    projections are written here too, for the same synthetic tenant, so the drift check
 *    stays clean.
 *
 * Coverage: both `artifactType`s, both `channel`s, active and deactivated rows, and a
 * module row at a version older than the manifest (an upgrade that has not run).
 *
 * Idempotent: keyed on the composite primary key; dates are fixed.
 */
export async function seedModuleLifecycleFull(ctx: SeedContext): Promise<void> {
  const { foc } = ctx
  const tenantId = SYNTHETIC_INSTALL_TENANT_ID

  type Def = {
    artifactType: 'module' | 'plugin'
    artifactId: string
    version: string
    active: boolean
    channel: 'release' | 'test'
    installedAt: Date
    updatedAt: Date
  }
  const defs: Def[] = [
    { artifactType: 'module', artifactId: 'bookings', version: '1.0.0', active: true, channel: 'release', installedAt: at(300), updatedAt: at(300) },
    { artifactType: 'module', artifactId: 'comments', version: '0.9.0', active: true, channel: 'release', installedAt: at(250), updatedAt: at(40) },
    { artifactType: 'module', artifactId: 'field_service', version: '1.0.0', active: false, channel: 'release', installedAt: at(200), updatedAt: at(20) },
    { artifactType: 'plugin', artifactId: LISTING.release, version: VERSION.release, active: true, channel: 'release', installedAt: at(150), updatedAt: at(150) },
    { artifactType: 'plugin', artifactId: LISTING.paused, version: VERSION.paused, active: false, channel: 'release', installedAt: at(120), updatedAt: at(10) },
    { artifactType: 'plugin', artifactId: LISTING.testChannel, version: VERSION.testChannel, active: true, channel: 'test', installedAt: at(60), updatedAt: at(5) },
  ]

  const repo = ctx.repo<Install>(Install)
  for (const def of defs) {
    await foc(
      repo,
      { tenantId, artifactType: def.artifactType, artifactId: def.artifactId } as FindOptionsWhere<Install>,
      { tenantId, ...def },
    )
  }

  // The read projections the ledger's real writers maintain, so the drift check stays clean.
  const settings: Array<{ key: string; value: string; group: string; type: string }> = []
  for (const def of defs) {
    if (def.artifactType === 'module') {
      settings.push({ key: `module.${def.artifactId}.enabled`, value: String(def.active), group: 'Modules', type: 'boolean' })
    } else {
      settings.push({ key: `plugin.community.${def.artifactId}.version`, value: def.version, group: 'Plugins', type: 'string' })
      settings.push({ key: `plugin.community.${def.artifactId}.active`, value: String(def.active), group: 'Plugins', type: 'boolean' })
      if (def.channel === 'test') {
        settings.push({ key: `plugin.community.${def.artifactId}.channel`, value: 'test', group: 'Plugins', type: 'string' })
      }
    }
  }
  const settingRepo = ctx.repo<Setting>(Setting)
  for (const s of settings) {
    await foc(settingRepo, { tenantId, key: s.key } as FindOptionsWhere<Setting>, { tenantId, ...s })
  }

  // Tenant module policies (`block`): on the synthetic tenant only, so no real tenant loses a module.
  const policyRepo = ctx.repo<ModulePolicy>(ModulePolicy)
  const policies = [
    { moduleId: 'field_service', reason: 'Blocked by the synthetic tenant\'s operator (seed).' },
    { moduleId: 'bookings', reason: null },
  ]
  for (const p of policies) {
    await foc(policyRepo, { tenantId, moduleId: p.moduleId } as FindOptionsWhere<ModulePolicy>, {
      tenantId, moduleId: p.moduleId, policy: 'block', reason: p.reason, createdBy: null,
    })
  }

  // Platform availability states, one per state, for synthetic module ids that exist in no manifest:
  // a row for a real module would change the platform catalogue for every tenant.
  const availabilityRepo = ctx.systemRepo<ModuleAvailability>(ModuleAvailability)
  const states = ['available', 'unlisted', 'hidden', 'retired'] as const
  for (const state of states) {
    const moduleId = `seed_synthetic_${state}`
    await foc(availabilityRepo, { moduleId } as FindOptionsWhere<ModuleAvailability>, {
      moduleId, state, reason: state === 'available' ? null : `Synthetic ${state} module (seed).`, updatedBy: null,
    })
  }

  ctx.refs.syntheticInstallTenantId = tenantId
  ctx.log(`module_lifecycle(full): ${defs.length} historic install rows + ${settings.length} projection settings + ${policies.length} module policies for synthetic tenant ${tenantId}, ${states.length} synthetic availability rows`)
}
