import { z } from 'zod'
import { ObservabilityConfigDTO, CONFIG_SCHEMA_ID } from './config.dto'

/**
 * `roltek-observability-1` as a JSON Schema (observability phase 21.1), generated from the same DTO the API validates with, exactly like
 * `roltek-monitor-1` (`uptime.monitor.schema.ts`). `schema/roltek-observability-1.schema.json` is the committed output and a test fails
 * when it differs from this function; `npm run gen:observability-schema` rewrites it.
 *
 * Rules that span fields or entries (a TCP target must be host:port, a key is unique, a reference points at a defined key, a dependency
 * graph has no loop) are not expressible as plain JSON Schema; the server and the CLI enforce them with one function
 * (`checkDocument`) and say so here instead of hiding it.
 */
export function observabilityConfigJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(ObservabilityConfigDTO, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: CONFIG_SCHEMA_ID,
    title: 'Roltek observability configuration',
    description:
      'Monitors, status components, SLOs, alert routes, silence templates, alert ingest integrations (metadata only), alert dependencies and incident update templates, as one reviewable document. ' +
      'Every resource has a stable `key`; references name keys, never ids. Secret values are references ({"fromEnv": "NAME"} or {"fromFile": "path"}) the CLI resolves; ingest keys and heartbeat tokens are never part of a file. ' +
      'Per-field rules, unique keys, resolvable references and loop-free dependencies are enforced by the server and the CLI and reported with a path and a message.',
    ...schema,
  }
}
