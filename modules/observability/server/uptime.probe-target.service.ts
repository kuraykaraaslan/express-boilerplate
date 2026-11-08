import 'reflect-metadata'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import { ext, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext'
import { observabilityProbeTargetLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/observability.probe-target'
import { Monitor } from './entities/monitor.entity'
import { MonitorTypeEnum } from './uptime.enums'
import { PROBE_TARGET_POINT, type ProbeTargetProvider, type ProbeTargetSpec } from './uptime.probe-target.types'

const KEY_RE = /^[a-z0-9._-]{1,100}$/

export interface ProbeTargetSyncSummary {
  created: number
  updated: number
  deactivated: number
  /** Specs a provider returned that failed validation (skipped, never thrown). */
  rejected: number
  /** Providers that threw — their existing monitors were left alone. */
  providersFailed: number
}

function valid(spec: ProbeTargetSpec): boolean {
  return KEY_RE.test(spec.key ?? '')
    && typeof spec.name === 'string' && spec.name.length > 0 && spec.name.length <= 200
    && MonitorTypeEnum.safeParse(spec.type).success
    && typeof spec.target === 'string' && spec.target.length > 0 && spec.target.length <= 500
    && (spec.intervalSeconds === undefined || (Number.isInteger(spec.intervalSeconds) && spec.intervalSeconds >= 15))
    && (spec.timeoutMs === undefined || (Number.isInteger(spec.timeoutMs) && spec.timeoutMs > 0 && spec.timeoutMs <= 60_000))
}

/**
 * Reconcile the monitors modules contribute through `observability:probe-target` with the `monitors` table, for one tenant. This is the one path by
 * which a provider's health becomes an uptime monitor — modules never grow a health checker of their own, and never import `observability`.
 *
 * The provider owns a managed monitor's identity, target and `isActive`:
 *  - missing → created; any owned field that differs → updated (a retired target that reappears is reactivated);
 *  - no longer reported by a provider that answered → DEACTIVATED, not deleted (history and incidents stay readable);
 *  - a provider that THROWS (or times out, or fails to load) leaves its monitors untouched — failing to enumerate is not evidence the target is
 *    gone; so does a provider whose module is not active for the tenant (it is not asked, which is not an answer either);
 *  - an operator opts a target out by deleting its monitor: the soft-deleted row keeps the `sourceKey`, and sync does not resurrect it.
 */
export async function syncProbeTargets(tenantId: string): Promise<ProbeTargetSyncSummary> {
  const summary: ProbeTargetSyncSummary = { created: 0, updated: 0, deactivated: 0, rejected: 0, providersFailed: 0 }
  // Providers of the modules active for this tenant; the host runtime isolates each one and logs the ones that fail.
  const { results, failed } = await ext.aggregate<ProbeTargetProvider, ProbeTargetSpec[]>(
    PROBE_TARGET_POINT, tenantCtx(tenantId), observabilityProbeTargetLoaders,
    async (provider) => {
      const specs = await provider.listTargets(tenantId)
      // not a list is a failed enumeration, never "no targets" (that would deactivate every monitor it owns)
      if (!Array.isArray(specs)) throw new Error('listTargets did not answer a list')
      return specs
    },
  )
  summary.providersFailed = failed.length
  if (results.length === 0) return summary

  const desired = new Map<string, ProbeTargetSpec>()
  const answered = new Set<string>() // module ids whose provider returned a list
  for (const { contribution, value: specs } of results) {
    answered.add(contribution.moduleId)
    for (const spec of specs) {
      if (!valid(spec)) { summary.rejected += 1; continue }
      desired.set(`${contribution.moduleId}:${spec.key}`, spec)
    }
  }

  await withTenantRepositoryFor(tenantId, Monitor, async (repo) => {
    const managed = (await repo.find({ where: { tenantId }, withDeleted: true })).filter((m) => m.sourceKey)
    const bySource = new Map(managed.map((m) => [m.sourceKey as string, m]))

    for (const [sourceKey, spec] of desired) {
      const row = bySource.get(sourceKey)
      if (row?.deletedAt) continue // operator opted out
      const want = {
        name: spec.name, type: spec.type, target: spec.target,
        intervalSeconds: spec.intervalSeconds ?? 60, timeoutMs: spec.timeoutMs ?? 10_000,
        expectedStatus: spec.expectedStatus ?? null, degradedLatencyMs: spec.degradedLatencyMs ?? null,
        isActive: true,
      }
      if (!row) {
        await repo.save(repo.create({ ...want, tenantId, sourceKey, lastStatus: 'UNKNOWN', consecutiveFailures: 0, consecutiveSuccesses: 0 }))
        summary.created += 1
        continue
      }
      const patch: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(want)) if (((row as unknown as Record<string, unknown>)[k] ?? null) !== v) patch[k] = v
      if (Object.keys(patch).length) { await repo.update({ tenantId, monitorId: row.monitorId }, patch); summary.updated += 1 }
    }

    for (const row of managed) {
      const sourceKey = row.sourceKey as string
      if (desired.has(sourceKey) || row.deletedAt || !row.isActive) continue
      if (!answered.has(sourceKey.slice(0, sourceKey.indexOf(':')))) continue
      await repo.update({ tenantId, monitorId: row.monitorId }, { isActive: false })
      summary.deactivated += 1
    }
  })
  return summary
}
