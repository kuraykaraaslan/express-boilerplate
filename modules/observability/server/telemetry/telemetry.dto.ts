/** Request bodies of the telemetry API that are not port queries. All strict: an unknown key is a 400, never ignored. */
import { z } from 'zod';
import { FIELD_NAME, LogQuerySchema, MetricQuerySchema, SIGNALS, TRACE_ID_RE, TimeRangeSchema, TraceSearchSchema } from './telemetry.types';

export const ServiceMapInputSchema = z.object({
  range: TimeRangeSchema,
  /** How many recent traces the map is derived from (a sample, not the whole population). */
  traceLimit: z.number().int().min(1).max(100).default(30),
}).strict();
export type ServiceMapInput = z.infer<typeof ServiceMapInputSchema>;

/** Labels an alert or incident hands over to find the telemetry that shares them: field names as in a log filter, values as literals, at most five. */
const CorrelateLabelsSchema = z.record(z.string().regex(FIELD_NAME, 'invalid label name'), z.string().max(256)).refine((o) => Object.keys(o).length <= 5, 'at most five labels');

export const CorrelateInputSchema = z.object({
  traceId: z.string().regex(TRACE_ID_RE).optional(),
  requestId: z.string().regex(/^[A-Za-z0-9._-]{8,64}$/).optional(),
  /** Centre of the window when neither id is given (or a hint when one is). */
  atMs: z.number().int().nonnegative().optional(),
  /** Half-width of the window around `atMs`. */
  windowMs: z.number().int().min(1000).max(3_600_000).default(300_000),
  /** An explicit window, for an alert or an incident: the signals inside it. Over the tenant's range cap it is a 400, never clipped. */
  window: TimeRangeSchema.optional(),
  /** With a window or a time: only signals that carry these labels (`service.name` and its aliases select the service). Falls back, visibly, to the window alone. */
  labels: CorrelateLabelsSchema.optional(),
}).strict().refine((v) => v.traceId || v.requestId || v.atMs !== undefined || v.window, 'give a traceId, a requestId, a time or a window');
export type CorrelateInput = z.infer<typeof CorrelateInputSchema>;

export const SavedQueryInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  signal: z.enum(['logs', 'traces', 'metrics']),
  /** A validated structured query WITHOUT its time range (a saved query is relative; the page supplies the window). */
  query: z.record(z.string(), z.unknown()),
}).strict();
export type SavedQueryInput = z.infer<typeof SavedQueryInputSchema>;

/** The stored shape of a saved query's body: the structured query with the time range removed, validated per signal. */
export function validateSavedBody(signal: 'logs' | 'traces' | 'metrics', query: Record<string, unknown>): Record<string, unknown> {
  const range = { fromMs: 0, toMs: 1 };
  if ('range' in query) throw new z.ZodError([{ code: 'custom', path: ['query', 'range'], message: 'a saved query carries no time range' }]);
  const schema = signal === 'logs' ? LogQuerySchema : signal === 'traces' ? TraceSearchSchema : MetricQuerySchema;
  const parsed = schema.parse({ ...query, range, ...(signal === 'metrics' ? { stepSeconds: (query as { stepSeconds?: number }).stepSeconds ?? 60 } : {}) }) as Record<string, unknown>;
  delete parsed.range;
  return parsed;
}

export const RetentionInputSchema = z.object({
  days: z.object({
    logs: z.number().int().min(1).max(3650).optional(),
    traces: z.number().int().min(1).max(3650).optional(),
    metrics: z.number().int().min(1).max(3650).optional(),
  }).strict().refine((d) => Object.keys(d).length > 0, 'give a retention for at least one signal'),
}).strict();

export const EraseInputSchema = z.object({
  /** Must equal the workspace id: erasing is irreversible, so it takes a deliberate, unguessable-by-accident confirmation. */
  confirm: z.string().uuid(),
  signals: z.array(z.enum(['logs', 'traces', 'metrics'])).min(1).max(3).optional(),
}).strict();

export const RawInputSchema = z.object({
  signal: z.enum(SIGNALS as unknown as [string, ...string[]]),
  text: z.string().min(1).max(4000),
  range: TimeRangeSchema,
  limit: z.number().int().min(1).max(1000).default(100),
}).strict();

/** The ranges a saved panel can open on: a panel is relative (the stored query has no time range), so it always shows the last N. */
export const PANEL_RANGES = ['15m', '1h', '6h', '24h', '7d'] as const;

/**
 * A saved metric panel: the structured metric query WITHOUT its range, step or exemplar flag (derived from `MetricQuerySchema`, so field names,
 * aggregations, filter operators and lengths are the query API's own), the range it opens on, and whether it shows exemplars. Strict: an unknown key
 * is a 400, and a raw query has nowhere to go.
 */
export const SavedPanelInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  rangePreset: z.enum(PANEL_RANGES).default('1h'),
  showExemplars: z.boolean().default(false),
  query: MetricQuerySchema.omit({ range: true, stepSeconds: true, exemplars: true }).strict(),
}).strict();
export type SavedPanelInput = z.infer<typeof SavedPanelInputSchema>;

/** Attribute comparison (18.6): failing request spans against the baseline of the same population, over a sample of recent traces. */
export const CompareInputSchema = z.object({
  range: TimeRangeSchema,
  service: z.string().max(256).optional(),
  /** Restrict both populations to spans of this name (a route, an operation). */
  name: z.string().max(256).optional(),
  /** What "failing" means: `error` (status ERROR) or `slow` (at least `slowerThanMs`). */
  failing: z.enum(['error', 'slow']).default('error'),
  slowerThanMs: z.number().positive().max(86_400_000).optional(),
  /** How many recent traces the populations are sampled from. */
  traceLimit: z.number().int().min(1).max(100).default(50),
}).strict().refine((v) => v.failing !== 'slow' || v.slowerThanMs !== undefined, 'give slowerThanMs when failing is "slow"');
export type CompareInput = z.infer<typeof CompareInputSchema>;

export const CompareSettingsInputSchema = z.object({ enabled: z.boolean() }).strict();

/** Release health (18.7): vitals and error rate by release over a range of the browser snippet's metrics. */
export const ReleaseHealthInputSchema = z.object({
  range: TimeRangeSchema,
  environment: z.string().max(128).optional(),
  /** Releases returned, most page views first. */
  limit: z.number().int().min(1).max(20).default(10),
}).strict();
export type ReleaseHealthInput = z.infer<typeof ReleaseHealthInputSchema>;
