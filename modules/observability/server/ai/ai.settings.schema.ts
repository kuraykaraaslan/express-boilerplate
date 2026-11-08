/**
 * The tenant's AI switches (phase 20). Everything defaults to OFF: with no stored document no data leaves the deployment because of this
 * module, whatever else is installed. Unreadable or malformed settings also mean OFF (fail closed).
 *
 * `providers` is the allow-list: the investigator, the drafts and the natural-language query only ever call a provider named here, and an empty
 * list means none. That list is also the data-residency control: the tenant picks the providers it accepts evidence being sent to.
 */
import { z } from 'zod';

export const MAX_DAILY_CAP = 500;
export const MAX_AUTO_RUN_DELAY_MINUTES = 60;
export const DEFAULT_AUTO_RUN_DELAY_MINUTES = 2;

const FIELDS = {
  /** The master switch: no model call of any kind unless true. */
  enabled: z.boolean(),
  /** Run the investigator once when an incident opens (needs `enabled`). The run is DELAYED by `autoRunDelayMinutes`, because the evidence is thinnest at the moment of opening. */
  onIncidentOpen: z.boolean(),
  /** Minutes between the incident opening and the automatic run (0 runs at once). Default 2: long enough for the alert group, the first changes and telemetry to land. */
  autoRunDelayMinutes: z.number().int().min(0).max(MAX_AUTO_RUN_DELAY_MINUTES),
  /** Run the investigator once more when the incident resolves, with the whole picture (needs `enabled`). At most one such run per incident. */
  onIncidentResolve: z.boolean(),
  /** Add embedding similarity to the similar-incident lookup (needs `enabled`, a provider with embeddings, and costs one embedding call per resolved incident). Off: group, monitor and text matching only. */
  similarByEmbedding: z.boolean(),
  /** An embedding model to ask for; empty uses the provider's default. */
  embeddingModel: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,99}$/),
  /** Model calls per UTC day, all features together. 0 means none today. */
  dailyCap: z.number().int().min(0).max(MAX_DAILY_CAP),
  /** Provider keys (`openai`, `anthropic`, ...) the tenant allows. First one is used. Empty: nothing may be called. */
  providers: z.array(z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,59}$/)).max(10),
  /** A model to ask for; empty uses the provider's default. */
  model: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,99}$/),
  /** Emit OpenTelemetry GenAI spans for NB's own model calls (also needs the deployment flag GENAI_TRACING=true). */
  genAiTracing: z.boolean(),
};

export const AiSettingsSchema = z.object({
  v: z.literal(1).default(1),
  enabled: FIELDS.enabled.default(false),
  onIncidentOpen: FIELDS.onIncidentOpen.default(false),
  autoRunDelayMinutes: FIELDS.autoRunDelayMinutes.default(DEFAULT_AUTO_RUN_DELAY_MINUTES),
  onIncidentResolve: FIELDS.onIncidentResolve.default(false),
  similarByEmbedding: FIELDS.similarByEmbedding.default(false),
  embeddingModel: FIELDS.embeddingModel.optional(),
  dailyCap: FIELDS.dailyCap.default(20),
  providers: FIELDS.providers.default([]),
  model: FIELDS.model.optional(),
  genAiTracing: FIELDS.genAiTracing.default(false),
}).strict();
export type AiSettings = z.infer<typeof AiSettingsSchema>;

export const AI_SETTINGS_DEFAULT: AiSettings = AiSettingsSchema.parse({});

/**
 * A patch names only the fields it changes. Built from the bare field schemas: a `.partial()` of the settings schema would fill every missing field with its DEFAULT and silently reset what the patch did not mention.
 * `model: null` clears the override (back to the provider's default); an omitted `model` leaves it as it is.
 */
export const AiSettingsPatchSchema = z.object({ ...FIELDS, model: FIELDS.model.nullable() }).partial().strict();
export type AiSettingsPatch = z.infer<typeof AiSettingsPatchSchema>;

/** The stored settings with a patch applied: a `null` field is removed (unset), an omitted one is kept. */
export function mergeAiSettings(current: AiSettings, patch: AiSettingsPatch): AiSettings {
  const next: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete next[k];
    else if (v !== undefined) next[k] = v;
  }
  return AiSettingsSchema.parse({ ...next, v: 1 });
}

export function parseAiSettings(raw: string | null | undefined): AiSettings {
  if (!raw) return AI_SETTINGS_DEFAULT;
  try {
    const r = AiSettingsSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : AI_SETTINGS_DEFAULT;
  } catch {
    return AI_SETTINGS_DEFAULT;
  }
}
