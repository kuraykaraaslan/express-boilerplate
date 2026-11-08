import type { AlertIntegration } from './entities/alert_integration.entity'
import { clampSeverity, type AlertSignal } from './alert.ingest.parsers'

/**
 * What an integration's key does to every signal it carries (observability phase 11). The sender controls labels and annotations; the key
 * controls the rest.
 *
 *  - Severity is clamped to the integration's ceiling: a leaked key cannot page at CRITICAL.
 *  - `entity` and `monitorId` are RESERVED. They drive the dependency graph and the monitor-to-incident link, so a sender that could set
 *    them could mute another system's alerts by claiming to be its parent. Only the integration's own `defaultLabels` may carry them.
 *  - The integration's default labels win over the payload's on a clash.
 */
export const RESERVED_LABELS = ['entity', 'monitorId'] as const

export function hardenSignal(signal: AlertSignal, integration: Pick<AlertIntegration, 'severityCeiling' | 'defaultLabels' | 'integrationId'>): AlertSignal {
  const labels: Record<string, string> = {}
  for (const [k, v] of Object.entries(signal.labels)) if (!(RESERVED_LABELS as readonly string[]).includes(k)) labels[k] = v
  Object.assign(labels, integration.defaultLabels ?? {})
  return { ...signal, source: 'integration', sourceRef: integration.integrationId, labels, severity: clampSeverity(signal.severity, integration.severityCeiling), monitorId: null }
}
