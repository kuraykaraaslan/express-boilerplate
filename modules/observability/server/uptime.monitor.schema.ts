import { z } from 'zod'
import { MonitorFieldsDTO } from './uptime.dto'

/**
 * `roltek-monitor-1` — the monitor definition as a JSON Schema (observability phase 09.8, consumed by phase 21's CLI and importers).
 *
 * Generated from `MonitorFieldsDTO`, the same object the create route validates with, so the schema, the API and the import file cannot
 * drift: there is no second description to keep in step. `modules/observability/schema/roltek-monitor-1.schema.json` is the
 * committed output and a test fails when it differs from this function.
 *
 * Rules that span fields (a TCP target must be host:port, a STEPS monitor needs steps) are not expressible as plain JSON Schema; the
 * server enforces them and `monitorProblem` is the single source for those, so a file that validates here can still be refused with a
 * specific message. That is stated in the schema description rather than hidden.
 */
export const MONITOR_SCHEMA_ID = 'roltek-monitor-1'

export function monitorJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(MonitorFieldsDTO, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: MONITOR_SCHEMA_ID,
    title: 'Roltek monitor',
    description: 'One uptime monitor. Per-type rules (for example "a TCP target must be host:port") are enforced by the server and reported with a specific message.',
    ...schema,
  }
}
