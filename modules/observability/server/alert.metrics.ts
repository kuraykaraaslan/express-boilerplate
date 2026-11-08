import ObservabilityService from './observability.service'

/**
 * The alert pipeline's own metrics, in the one registry. Handles are no-ops until metrics are initialised, and every call is wrapped
 * so a telemetry failure can never stop an alert: the pipeline exists to tell people about failures, and must not be taken down by
 * the instrument that counts them.
 */
type Labels = Record<string, string | number>

function safeCounter(spec: { name: string; help: string; labelNames: string[] }): { inc(labels?: Labels): void } {
  const handle = ObservabilityService.counter(spec)
  return { inc: (labels) => { try { handle.inc(labels) } catch { /* telemetry must not break the pipeline */ } } }
}

export const alertMetrics = {
  ingested: safeCounter({ name: 'alerts_ingested_total', help: 'Alert signals accepted by the pipeline', labelNames: ['source', 'status'] }),
  suppressed: safeCounter({ name: 'alerts_suppressed_total', help: 'Alerts stored but not announced', labelNames: ['reason'] }),
  groupsDispatched: safeCounter({ name: 'alert_groups_dispatched_total', help: 'Alert groups announced', labelNames: ['incident'] }),
  targetFailures: safeCounter({ name: 'alert_target_failures_total', help: 'Route targets that could not deliver', labelNames: ['type'] }),
  labelsDropped: safeCounter({ name: 'alert_labels_dropped_total', help: 'Sender-supplied alert labels dropped or cut by the cardinality bounds', labelNames: ['reason'] }),
  ingestRejected: safeCounter({ name: 'alert_ingest_rejected_total', help: 'Ingest requests refused', labelNames: ['reason'] }),
}

/** `inhibited:component:abc` → `inhibited`; the label stays low-cardinality. */
export function suppressionReason(by: string): string {
  return by.split(':')[0] || 'unknown'
}
