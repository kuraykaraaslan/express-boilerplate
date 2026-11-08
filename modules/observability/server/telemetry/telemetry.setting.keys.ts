/** Per-tenant setting keys of the telemetry feature (stored in the shared `settings` table, one JSON document each). */
export const TELEMETRY_SETTING_KEYS = {
  /** `{ v: 1, items: SavedQuery[] }`, at most 50 items. */
  SAVED_QUERIES: 'observabilityTelemetrySavedQueries',
  /** `{ v: 1, items: SavedPanel[] }`, at most 50 items. */
  SAVED_PANELS: 'observabilityTelemetrySavedPanels',
  /** `'true'` to switch attribute comparison (BubbleUp, phase 18.6) on for the workspace. Absent or anything else = off. */
  ATTRIBUTE_COMPARISON: 'observabilityTelemetryAttributeComparison',
  /** `{ v: 1, items: { [apiKeyId]: BrowserKeyConfig } }`, at most 20 keys: the Origin allow-list and rate limit of each browser ingest key. */
  BROWSER_KEYS: 'observabilityTelemetryBrowserKeys',
  /** `{ days: { logs?, traces?, metrics? }, updatedAt }`: the last retention the tenant asked the backend for. */
  RETENTION: 'observabilityTelemetryRetention',
} as const;
