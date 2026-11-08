/**
 * The contract of the Core telemetry store (docs/phases/42-telemetry/00 §0.3–§0.5, ED-10…ED-12): readings of any registered
 * entity kind over time, one row per message per retention class, a per-tenant key dictionary, the latest value per entity and
 * key, 1-minute aggregates with hour and day rollups. Nothing here knows a device: the IoT layer (`iot_telemetry`) adds the
 * device protocol on top and registers the kind `iot_device`.
 *
 * Type-only except for the constants.
 */

/** A value as stored: numbers go to `numVals`, everything else to `other` (jsonb). */
export type TelemetryValue = number | boolean | string | Record<string, unknown> | unknown[];

/** Why a key or a value was refused (counted by the caller, never stored). */
export type TelemetryDropReason = 'bad_form' | 'bad_ts' | 'key_invalid' | 'key_reserved' | 'key_too_long' | 'value_too_large' | 'string_too_long';

/** One row for the writer: a reading of one entity at one time, with its key/value pairs. */
export interface TelemetryWriteRow {
  entityId: string;
  /** Epoch ms. */
  ts: number;
  values: Record<string, TelemetryValue>;
}

export interface TelemetryWriteResult {
  /** Rows inserted (new messages). */
  written: number;
  /** Rows that already existed (same entity, ts and `msgHash`): a replay. */
  duplicates: number;
  /** Rows refused by a rule, the budget, the database or a cap; the caller routes them to its error path. */
  errors: Array<{ index: number; reason: string }>;
  /** Keys whose latest value advanced (strict `>` on ts), for live deltas. */
  latestChanged: Array<{ entityId: string; key: string; ts: number; value: TelemetryValue }>;
  /**
   * The input indexes of the rows this call inserted, ascending: a replay (the row existed), a later copy in the same wave and a refused
   * row are not here. A live path publishes these only, so a reading reaches a viewer once however often it was written (the store's
   * `msgHash` idempotency, carried to the live side; 2026-11-02 siege R11). Optional: a writer that does not report it leaves it out.
   */
  inserted?: number[];
}

/**
 * Writes one tenant's wave of rows of ONE kind in one transaction (RLS: the tenant's context): the raw message row per record
 * (`<lane>_msg_r{class}`, `msgHash` = first 8 bytes of SHA-1 over the canonical `values`, `ON CONFLICT DO NOTHING`), the key
 * dictionary (`telemetry_keys`, per tenant), the latest value (strict `>`), and a dirty-minute hint for the lane's 1-minute rollup
 * job. A call never spans kinds or lanes (ED-12). A connection failure throws (the caller pauses; nothing is dead-lettered); a
 * row-level failure is reported in `errors`. Commit listeners run after the returned promise resolves (ED-11).
 */
export interface TelemetryWriter {
  write(tenantId: string, kind: string, rows: readonly TelemetryWriteRow[]): Promise<TelemetryWriteResult>;
}

/** Retention classes in days (00 §0.5): a binding of a tenant and a kind names one; the raw window of each is shorter. */
export const RETENTION_CLASSES = [7, 30, 90, 365, 1095] as const;
export type RetentionClass = (typeof RETENTION_CLASSES)[number];
export const DEFAULT_RETENTION_CLASS: RetentionClass = 30;

/** The table family every kind writes to unless it declares its own (00 §0.8b, ED-9). */
export const DEFAULT_LANE = 'default';
