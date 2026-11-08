import type { Importer } from './importer.types'
import { uptimeKumaImporter } from './uptime-kuma'
import { uptimeRobotImporter } from './uptimerobot'
import { statuspageImporter } from './statuspage'
import { prometheusRulesImporter } from './prometheus-rules'

export type { Importer, ImportReport, ImportResult } from './importer.types'

/** The converters to `roltek-observability-1`. On-call importers (Opsgenie, Grafana OnCall) live in the `on_call` module and are listed by the CLI separately. */
export const IMPORTERS: Record<string, Importer> = {
  [uptimeKumaImporter.id]: uptimeKumaImporter,
  [uptimeRobotImporter.id]: uptimeRobotImporter,
  [statuspageImporter.id]: statuspageImporter,
  [prometheusRulesImporter.id]: prometheusRulesImporter,
}
