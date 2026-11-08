import 'reflect-metadata'
import { In } from 'typeorm'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import { ext, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext'
import { observabilityAlertSourceLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/observability.alert-source'
import { Alert } from './entities/alert.entity'
import { ALERT_SOURCE_POINT, type AlertSourceProvider, type AlertSourceSpec } from './alert.source.types'
import { alertFingerprint } from './alert.fingerprint'
import { AlertSeverityEnum } from './alert.enums'
import { sanitizeLabels } from './alert.matchers'
import type { AlertSignal } from './alert.ingest.parsers'
import AlertService from './alert.service'

const KEY_RE = /^[a-z0-9._-]{1,100}$/
const MAX_SPECS_PER_PROVIDER = 200

export interface AlertSourceSyncSummary { raised: number; resolved: number; rejected: number; providersFailed: number }

/** What a contributed spec becomes. The pipeline owns the entity and the source; the provider owns the words. Exported for tests. */
export function signalFromSpec(moduleId: string, spec: AlertSourceSpec): AlertSignal {
  const labels = sanitizeLabels(spec.labels)
  // Reserved: a plugin must not be able to claim to be a parent in the dependency graph, nor tie itself to a monitor.
  delete labels.entity; delete labels.monitorId
  labels.alertname = labels.alertname ?? spec.key
  labels.module = moduleId
  labels.entity = `ext:${moduleId}:${spec.key}`
  return {
    source: 'extension', sourceRef: moduleId, status: 'FIRING',
    severity: AlertSeverityEnum.safeParse(spec.severity).data ?? 'WARNING',
    title: spec.title.slice(0, 300), labels, annotations: spec.annotations ?? {},
    fingerprint: `${moduleId}:${spec.key}`,
  }
}

function valid(spec: AlertSourceSpec): boolean {
  return KEY_RE.test(spec.key ?? '') && typeof spec.title === 'string' && spec.title.length > 0 && spec.title.length <= 300
}

/**
 * Reconcile what modules say is firing (`observability:alert-source`) with the alerts table, for one tenant (observability phase 11).
 * `iot_alarm`, `fleet`, `automation` and `payment` report through this and never import `observability`, the same way provider health
 * reaches the uptime monitors. State-based: a provider lists what is firing now, so a recovery needs no separate message and a lost one
 * cannot leave an alert open forever.
 */
export async function syncAlertSources(tenantId: string): Promise<AlertSourceSyncSummary> {
  const summary: AlertSourceSyncSummary = { raised: 0, resolved: 0, rejected: 0, providersFailed: 0 }
  const { results, failed } = await ext.aggregate<AlertSourceProvider, AlertSourceSpec[]>(
    ALERT_SOURCE_POINT, tenantCtx(tenantId), observabilityAlertSourceLoaders,
    async (provider) => {
      const specs = await provider.listFiring(tenantId)
      // not a list is a failed enumeration, never "all clear" (that would resolve everything this module raised)
      if (!Array.isArray(specs)) throw new Error('listFiring did not answer a list')
      return specs.slice(0, MAX_SPECS_PER_PROVIDER)
    },
  )
  summary.providersFailed = failed.length
  if (results.length === 0) return summary

  const answered = new Set<string>()
  const current = new Set<string>()
  for (const { contribution, value: specs } of results) {
    const moduleId = contribution.moduleId
    answered.add(moduleId)
    for (const spec of specs) {
      if (!valid(spec)) { summary.rejected += 1; continue }
      const signal = signalFromSpec(moduleId, spec)
      current.add(alertFingerprint('extension', sanitizeLabels(signal.labels), signal.fingerprint))
      const before = await withTenantRepositoryFor(tenantId, Alert, (repo) => repo.count({ where: { tenantId, fingerprint: alertFingerprint('extension', sanitizeLabels(signal.labels), signal.fingerprint), status: In(['FIRING', 'SUPPRESSED']) } }))
      const r = await AlertService.ingest(tenantId, signal)
      if (r && before === 0) summary.raised += 1
    }
  }

  // Alerts a module raised earlier that it no longer lists: it answered, and it did not list them, so they have recovered.
  const open = await withTenantRepositoryFor(tenantId, Alert, (repo) => repo.find({ where: { tenantId, source: 'extension', status: In(['FIRING', 'SUPPRESSED']) }, take: 2000 }))
  for (const alert of open) {
    if (!alert.sourceRef || !answered.has(alert.sourceRef) || current.has(alert.fingerprint)) continue
    if (await AlertService.resolve(tenantId, { alertId: alert.alertId })) summary.resolved += 1
  }
  return summary
}
