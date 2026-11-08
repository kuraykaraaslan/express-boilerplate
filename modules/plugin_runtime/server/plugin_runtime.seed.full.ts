import 'reflect-metadata'
import type { FindOptionsWhere } from 'typeorm'
import type { SeedContext } from '@kuraykaraaslan-labs/db/server/db.seed-contracts'
import { PluginKv } from './entities/plugin_kv.entity'

/**
 * Plugin scoped names owned by the seed. No marketplace listing and no installed plugin has
 * either name, and the broker only ever reads rows under the calling plugin's own name, so
 * no running plugin can see these keys. Both are marked synthetic in the name itself.
 */
export const SYNTHETIC_PLUGIN_IDS = {
  notes: '@seed-synthetic/notes',
  counters: '@seed-synthetic/counters',
} as const

const DAY = 24 * 60 * 60 * 1000
const ANCHOR = Date.UTC(2026, 5, 1, 9, 0, 0)
const at = (daysBeforeAnchor: number) => new Date(ANCHOR - daysBeforeAnchor * DAY)

type Json = string | number | boolean | Json[] | { [k: string]: Json }

/**
 * Full-load seed for `plugin_runtime`: the per-plugin key/value store (`plugin_kv`).
 *
 * Why this is NOT in the default seed (`plugin_runtime` is exempt as `runtime-state`): the
 * rows are written by a running sandboxed plugin through `host.data` and are meaningless
 * without that plugin. The full-load lane (guarded test database only) still needs the
 * table filled.
 *
 * Why it is inert: the keys belong to two synthetic plugin names (see
 * {@link SYNTHETIC_PLUGIN_IDS}) that no listing, install or isolate uses. Nothing in the
 * seed starts a plugin or calls the broker; rows are written through the repository. The
 * values are small documents with no secrets.
 *
 * Coverage: every JSON value shape the `jsonb` column accepts (object, nested object, array,
 * string, number, boolean, unicode text), several collections per plugin, keys sharing a
 * prefix (the `list({ prefix })` capability), and a key updated after it was created.
 * (A JSON `null` is not stored: the column is NOT NULL, and an absent key is how `delete`
 * is represented.)
 *
 * Idempotent: keyed on the composite primary key `(tenantId, pluginId, collection, key)`.
 */
export async function seedPluginRuntimeFull(ctx: SeedContext): Promise<void> {
  const { tenantId, foc } = ctx

  type Def = { pluginId: string; collection: string; key: string; value: Json; createdAt: Date; updatedAt: Date }
  const { notes, counters } = SYNTHETIC_PLUGIN_IDS
  const defs: Def[] = [
    { pluginId: notes, collection: 'notes', key: 'welcome', value: { title: 'Welcome', body: 'A synthetic note.', pinned: true }, createdAt: at(90), updatedAt: at(90) },
    { pluginId: notes, collection: 'notes', key: 'draft:1', value: { title: 'Draft one', body: '', pinned: false, tags: ['seed', 'synthetic'] }, createdAt: at(80), updatedAt: at(12) },
    { pluginId: notes, collection: 'notes', key: 'draft:2', value: { title: 'Draft two', body: 'Çok dilli içerik: 你好, мир, 🌍', pinned: false, tags: [] }, createdAt: at(79), updatedAt: at(79) },
    { pluginId: notes, collection: 'settings', key: 'ui', value: { theme: 'dark', density: 'compact', panels: { left: { open: true, width: 240 }, right: { open: false, width: 0 } } }, createdAt: at(90), updatedAt: at(30) },
    { pluginId: notes, collection: 'settings', key: 'last-sync', value: '2026-05-01T08:00:00.000Z', createdAt: at(60), updatedAt: at(31) },
    { pluginId: counters, collection: 'totals', key: 'visits', value: 1204, createdAt: at(200), updatedAt: at(1) },
    { pluginId: counters, collection: 'totals', key: 'ratio', value: 0.375, createdAt: at(200), updatedAt: at(1) },
    { pluginId: counters, collection: 'flags', key: 'onboarded', value: true, createdAt: at(150), updatedAt: at(150) },
    { pluginId: counters, collection: 'flags', key: 'beta', value: false, createdAt: at(150), updatedAt: at(100) },
    { pluginId: counters, collection: 'history', key: 'weekly', value: [3, 5, 8, 13, 21], createdAt: at(120), updatedAt: at(7) },
  ]
  const fillers = ctx.count(3)
  for (let i = 1; i <= fillers; i++) {
    defs.push({
      pluginId: notes,
      collection: 'cache',
      key: `entry:${String(i).padStart(3, '0')}`,
      value: { n: i, text: ctx.faker.sentence(5) },
      createdAt: at(20 + i),
      updatedAt: at(20 + i),
    })
  }

  const repo = ctx.repo<PluginKv>(PluginKv)
  for (const def of defs) {
    await foc(
      repo,
      { tenantId, pluginId: def.pluginId, collection: def.collection, key: def.key } as FindOptionsWhere<PluginKv>,
      { tenantId, ...def },
    )
  }

  ctx.log(`plugin_runtime(full): ${defs.length} plugin_kv rows under ${Object.keys(SYNTHETIC_PLUGIN_IDS).length} synthetic plugins for ${tenantId}`)
}
