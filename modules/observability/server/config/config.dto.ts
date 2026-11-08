import { z } from 'zod'
import { MonitorFieldsDTO, CreateStatusComponentDTO, refineMonitor } from '../uptime.dto'
import { SECRET_NAME } from '../uptime.steps.schema'
import { CreateRouteDTO, CreateIntegrationDTO, MAX_SILENCE_MINUTES } from '../alert.dto'
import { MatcherListSchema } from '../alert.matchers'
import { SloFieldsDTO, sloProblem } from '../slo.dto'
import { UpsertTemplateDTO } from '../incident.dto'
import { CONFIG_KINDS, KEY_MESSAGE, KEY_RE } from './config.kinds'

/**
 * `roltek-observability-1` (observability phase 21.1): ONE document for everything an operator configures from a repository.
 *
 * It is assembled from the DTOs the admin API validates with (`MonitorFieldsDTO`, `CreateRouteDTO`, `SloFieldsDTO` ...), so the file
 * format, the REST bodies and the generated JSON Schema (`schema/roltek-observability-1.schema.json`) are one description, not three.
 * What the document adds to each DTO is only a stable `key` (the identity that makes `apply` idempotent) and key references in place of
 * database ids (a monitor of a component is named by its key, never by a uuid that does not exist in another tenant).
 *
 * Deliberately NOT in the document: live silences (they are time-bound state; only TEMPLATES are code), alert ingest KEYS (a credential:
 * integrations carry metadata only and a created one returns its key once), heartbeat tokens, `pausedUntil` / `maintenanceUntil`
 * (operational, they expire by themselves), and on-call schedules and policies (they live in the `on_call` module).
 */
export const CONFIG_SCHEMA_ID = 'roltek-observability-1'

export const MAX_CONFIG_BYTES = 1_000_000

const Key = z.string().regex(KEY_RE, KEY_MESSAGE)
const keys = (max: number) => z.array(Key).max(max)

/**
 * A secret-valued field (a header value, a step secret). A literal string is allowed for a throwaway value; a real credential is a
 * REFERENCE the CLI resolves from the process environment or a file at apply time, so the committed file never holds it and it never
 * travels in argv. The server refuses a document that still carries a reference (`assertResolved`).
 */
export const SecretValueSchema = z.union([
  z.string().min(1).max(2000),
  z.object({ fromEnv: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,99}$/, 'an environment variable name') }).strict(),
  z.object({ fromFile: z.string().min(1).max(500) }).strict(),
])
export type SecretValue = z.infer<typeof SecretValueSchema>

const SecretMapSchema = z.record(z.string().regex(SECRET_NAME), SecretValueSchema).refine((m) => Object.keys(m).length <= 20, 'at most 20 secrets')

// ── monitors ────────────────────────────────────────────────────────────────

export const ConfigMonitorDTO = MonitorFieldsDTO
  .omit({ pausedUntil: true, maintenanceUntil: true, headers: true, secrets: true })
  .extend({
    key: Key,
    headers: z.record(z.string().min(1).max(100), SecretValueSchema).nullish(),
    secrets: SecretMapSchema.nullish(),
  })
  .strict()
  .superRefine(refineMonitor)
export type ConfigMonitor = z.infer<typeof ConfigMonitorDTO>

// ── status components ───────────────────────────────────────────────────────

export const ConfigComponentDTO = CreateStatusComponentDTO
  .omit({ monitorIds: true })
  .extend({ key: Key, monitors: keys(100).default([]) })
  .strict()
export type ConfigComponent = z.infer<typeof ConfigComponentDTO>

// ── SLOs ────────────────────────────────────────────────────────────────────

export const ConfigSloDTO = SloFieldsDTO
  .omit({ monitorIds: true, componentId: true })
  .extend({ key: Key, monitors: keys(100).default([]), component: Key.nullish() })
  .strict()
  .superRefine((s, ctx) => {
    const p = sloProblem({ kind: s.kind, monitorIds: s.monitors, componentId: s.component ?? null, latencyThresholdMs: s.latencyThresholdMs, metricSpec: s.metricSpec })
    if (p) ctx.addIssue({ code: 'custom', path: ['kind'], message: p })
  })
export type ConfigSlo = z.infer<typeof ConfigSloDTO>

// ── alert pipeline ──────────────────────────────────────────────────────────

/**
 * Array order is the route order: `position` is the index. A `position` given explicitly wins over the index, for a client that manages one
 * route at a time (the Terraform provider applies a one-route document, whose index is always 0); a file written by hand leaves it out.
 */
export const ConfigRouteDTO = CreateRouteDTO.extend({ key: Key }).strict()
export type ConfigRoute = z.infer<typeof ConfigRouteDTO>

/** A named, reusable silence: matchers, a length and a reason. Starting one is a separate act (a live silence is state, not code). */
export const ConfigSilenceTemplateDTO = z.object({
  key: Key,
  name: z.string().min(1).max(120),
  matchers: MatcherListSchema.refine((l) => l.length >= 1, 'a silence template needs at least one matcher (it would mute everything otherwise)'),
  durationMinutes: z.number().int().min(1).max(MAX_SILENCE_MINUTES),
  reason: z.string().trim().min(3).max(500),
}).strict()
export type ConfigSilenceTemplate = z.infer<typeof ConfigSilenceTemplateDTO>

/** Metadata only. The ingest key is a credential: a created integration returns it once, a file can never carry one. */
export const ConfigIntegrationDTO = CreateIntegrationDTO.extend({ key: Key, enabled: z.boolean().default(true) }).strict()
export type ConfigIntegration = z.infer<typeof ConfigIntegrationDTO>

/** `component:<key>` and `monitor:<key>` name members of this document (or code-managed ones already live); `process:<kind>` and `ext:<module>:<key>` are passed through. */
const EntityRef = z.string().regex(
  /^(?:(?:component|monitor):[a-z0-9][a-z0-9._-]{0,99}|process:[A-Za-z0-9_.-]{1,60}|ext:[A-Za-z0-9_.-]{1,60}:[A-Za-z0-9_.:-]{1,100})$/,
  'component:<key>, monitor:<key>, process:<kind> or ext:<module>:<key>',
)
export const ConfigDependencyDTO = z.object({ child: EntityRef, parent: EntityRef }).strict()
export type ConfigDependency = z.infer<typeof ConfigDependencyDTO>

export const ConfigIncidentTemplateDTO = UpsertTemplateDTO.strict()
export type ConfigIncidentTemplate = z.infer<typeof ConfigIncidentTemplateDTO>

// ── the document ────────────────────────────────────────────────────────────

export const ObservabilityConfigDTO = z.object({
  schema: z.literal(CONFIG_SCHEMA_ID),
  monitors: z.array(ConfigMonitorDTO).max(500).default([]),
  components: z.array(ConfigComponentDTO).max(200).default([]),
  slos: z.array(ConfigSloDTO).max(200).default([]),
  silenceTemplates: z.array(ConfigSilenceTemplateDTO).max(100).default([]),
  integrations: z.array(ConfigIntegrationDTO).max(50).default([]),
  routes: z.array(ConfigRouteDTO).max(100).default([]),
  dependencies: z.array(ConfigDependencyDTO).max(500).default([]),
  incidentTemplates: z.array(ConfigIncidentTemplateDTO).max(40).default([]),
}).strict()
export type ObservabilityConfig = z.infer<typeof ObservabilityConfigDTO>

/** The array fields of the document, by kind: the one place that maps `ConfigKind` to a property. */
export const KIND_FIELD: Record<(typeof CONFIG_KINDS)[number], keyof ObservabilityConfig> = {
  monitors: 'monitors', components: 'components', slos: 'slos', silenceTemplates: 'silenceTemplates', integrations: 'integrations',
  routes: 'routes', dependencies: 'dependencies', incidentTemplates: 'incidentTemplates',
}

/** What a request body carries to plan or apply: a parsed document, or text the server parses. Never both. */
export const ConfigRequestDTO = z.object({
  document: z.unknown().optional(),
  content: z.string().min(1).max(MAX_CONFIG_BYTES).optional(),
  format: z.enum(['yaml', 'json']).optional(),
  kinds: z.array(z.enum(CONFIG_KINDS)).max(CONFIG_KINDS.length).optional(),
  /** Delete code-managed resources that are no longer in the document. Without it nothing is ever deleted. */
  prune: z.boolean().default(false),
  /**
   * Delete exactly these code-managed resources when the document no longer holds them: a keyed `prune` for a client that manages one resource
   * at a time (the Terraform provider). A name is the identity `plan` reports (a key, `child>parent`, or `STATUS/locale`); it applies to the kinds
   * of the request. A name that is in the document is never deleted, a name nothing matches is ignored, and everything else is left alone.
   */
  pruneKeys: z.array(z.string().min(1).max(300)).max(100).optional(),
  /** Take over UI-created resources of the same kind and name instead of creating a duplicate. */
  adopt: z.boolean().default(false),
  /** `apply` only: refuse to write when the plan changed since the caller saw it (the hash `plan` returned). */
  planHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict().superRefine((b, ctx) => {
  if ((b.document === undefined) === (b.content === undefined)) ctx.addIssue({ code: 'custom', path: ['document'], message: 'send exactly one of `document` and `content`' })
  if (b.content !== undefined && !b.format) ctx.addIssue({ code: 'custom', path: ['format'], message: '`format` (yaml or json) is required with `content`' })
})
export type ConfigRequest = z.infer<typeof ConfigRequestDTO>

export const DetachDTO = z.object({
  kind: z.enum(CONFIG_KINDS),
  id: z.string().uuid(),
}).strict()
export type DetachInput = z.infer<typeof DetachDTO>
