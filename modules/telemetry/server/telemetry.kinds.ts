import { createHash } from 'node:crypto';
import { DEFAULT_LANE, DEFAULT_RETENTION_CLASS, type RetentionClass, type TelemetryDropReason, type TelemetryWriteRow } from './telemetry.contract';
import { isRetentionClass, LANE_NAME } from './telemetry.classes';
import { checkKey } from './telemetry.rules';

/**
 * The `telemetry:entity_kind` contract and registry (docs/phases/42-telemetry/00 §0.4). The module that owns the readings
 * contributes the kind: what its keys are, which retention class a tenant's rows take, who may read them, and where they are
 * stored (lane) and admitted (budget). The writer refuses an unregistered kind; every read path asks the kind's `canRead`.
 *
 * Contributions are loaded once per process from the generated point loaders (`ext.loadAll`, like `db:time_series`); tests
 * register kinds directly. A kind is a plain object, so registering it costs nothing on the hot path: the writer does one
 * `Map.get` per wave.
 */
export const ENTITY_KIND_POINT = 'telemetry:entity_kind';
/** `iot_device`, `fx.currency`, `observability.monitor`: lower-case words, dot-separated. */
export const KIND_NAME = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;
export const MAX_KIND_LENGTH = 64;
/** Rows per second per tenant a kind gets without declaring a budget (ED-12); `iot_device` declares `null` (no budget). */
export const DEFAULT_BUDGET_ROWS_PER_SECOND = 200;

/** Who is reading: the tenant always, the user when a request is behind it. A kind decides with this. */
export interface TelemetryReadContext {
  tenantId: string;
  userId?: string | null;
  [extra: string]: unknown;
}

export type TelemetryKeyType = 'gauge' | 'counter' | 'state' | 'text';

export type TelemetryKeySpec =
  /** The kind names its keys (or key prefixes such as `license.`); anything else is `key_invalid`. */
  | {
      mode: 'declared';
      keys: ReadonlyArray<{ key: string; type: TelemetryKeyType; unit?: string; label?: string }>;
      prefixes?: readonly string[];
    }
  /** Open keys (devices, OTel series): the generic rule applies, then the kind's own check; only open kinds grow the dictionary. */
  | {
      mode: 'open';
      checkKey?: (key: string) => TelemetryDropReason | null;
      /** Keys exempt from the string limit and capped by bytes instead (`raw`). */
      isRaw?: (key: string) => boolean;
      /** The tenant's key cap; `null` or absent: no cap. */
      maxKeysPerTenant?: (tenantId: string) => Promise<number | null>;
    };

export type TelemetryRetentionSpec =
  | { fixedClass: RetentionClass }
  | { resolveClass: (tenantId: string) => Promise<RetentionClass> };

export interface TelemetryEntityKind {
  kind: string;
  /** i18n key or plain label. */
  label: string;
  keys: TelemetryKeySpec;
  retention: TelemetryRetentionSpec;
  /** Record-level read check: which of these ids may this caller see? Default deny (an unknown kind is never served). */
  canRead(ctx: TelemetryReadContext, entityIds: readonly string[]): Promise<Set<string>>;
  /** Shown in the dashboard source picker and the generic API. Default false. */
  exposeToDashboards?: boolean;
  /** A flow's generic save node may write this kind, and an IoT binding may target it. Default false. */
  acceptsExternalWrites?: boolean;
  /**
   * Which of these entities an external writer (a flow acting as `actor`, a binding) may write; absent = every entity when
   * `acceptsExternalWrites` is true. Asked once per wave.
   */
  canWrite?(ctx: { tenantId: string; actor: string }, entityIds: readonly string[]): Promise<Set<string>>;
  /**
   * The permission a person must hold to point an external writer at this kind's entities (an IoT binding, docs/phases/42-telemetry/13
   * §13.1): the owner's manage permission of the entities. Absent: nobody may bind to the kind.
   */
  writePermission?: string;
  /** The entities a person may pick as a target (a binding form), by search text or by id, each with a label; at most `limit`. */
  entityOptions?(tenantId: string, o: { search?: string; ids?: readonly string[]; limit: number }): Promise<Array<{ id: string; label: string }>>;
  /**
   * How an external writer's rows enter when the owner keeps more than the readings (the asset's FIRST marks and meter rules): the rows
   * of entities `canWrite` admitted, each naming its writer under `source` when the kind's keys take that key. Absent: the store's
   * writer takes them as they are. Resolves with the rows stored and, per refused row index, why; throws when nothing could be decided
   * (the caller retries).
   */
  writeExternal?(tenantId: string, rows: readonly TelemetryWriteRow[]): Promise<{ written: number; errors: Array<{ index: number; reason: string }> }>;
  /** The table family (00 §0.8b); only a kind expected above ~100 rows/s on a large install gets its own. */
  lane?: string;
  /** Rows per second per tenant the writer admits; `null` = no budget. Default `DEFAULT_BUDGET_ROWS_PER_SECOND`. */
  budgetRowsPerSecond?: number | null;
}

const kinds = new Map<string, TelemetryEntityKind>();
const declaredKeys = new WeakMap<TelemetryEntityKind, { keys: Set<string>; prefixes: readonly string[] }>();
let loaded: Promise<void> | null = null;

export function kindProblem(k: TelemetryEntityKind): string | null {
  if (typeof k?.kind !== 'string' || !KIND_NAME.test(k.kind) || k.kind.length > MAX_KIND_LENGTH) return `kind name "${String(k?.kind)}" is not <word>(.<word>)*, at most ${MAX_KIND_LENGTH} characters`;
  if (k.lane !== undefined && !LANE_NAME.test(k.lane)) return `kind ${k.kind}: lane "${k.lane}" is not a lane name`;
  if ('fixedClass' in k.retention && !isRetentionClass(k.retention.fixedClass)) return `kind ${k.kind}: fixedClass ${String(k.retention.fixedClass)} is not a retention class`;
  if (typeof k.canRead !== 'function') return `kind ${k.kind}: canRead is required (default deny)`;
  if (k.keys.mode === 'declared') {
    for (const d of k.keys.keys) if (checkKey(d.key)) return `kind ${k.kind}: declared key "${d.key}" breaks the key rule`;
  }
  return null;
}

/** Registers a kind; the same object twice is fine, a second object for one name is an error (two modules claiming a kind). */
export function registerTelemetryKind(k: TelemetryEntityKind): void {
  const problem = kindProblem(k);
  if (problem) throw new Error(`[telemetry] ${problem}`);
  const have = kinds.get(k.kind);
  if (have && have !== k) throw new Error(`[telemetry] kind "${k.kind}" is already registered`);
  kinds.set(k.kind, k);
}

export const telemetryKindOf = (kind: string): TelemetryEntityKind | undefined => kinds.get(kind);
export const registeredTelemetryKinds = (): TelemetryEntityKind[] => [...kinds.values()];
export const laneOf = (k: TelemetryEntityKind): string => k.lane ?? DEFAULT_LANE;
/** The kinds of a lane (for its rollup job). */
export const kindsOfLane = (lane: string): string[] => registeredTelemetryKinds().filter((k) => laneOf(k) === lane).map((k) => k.kind);

/** The generic key rule, then the kind's: a declared kind admits its keys and prefixes only, an open kind asks its own check. */
export function keyProblem(k: TelemetryEntityKind, key: string): TelemetryDropReason | null {
  const generic = checkKey(key);
  if (generic) return generic;
  if (k.keys.mode === 'open') return k.keys.checkKey?.(key) ?? null;
  let d = declaredKeys.get(k);
  if (!d) {
    d = { keys: new Set(k.keys.keys.map((x) => x.key)), prefixes: k.keys.prefixes ?? [] };
    declaredKeys.set(k, d);
  }
  return d.keys.has(key) || d.prefixes.some((p) => key.startsWith(p)) ? null : 'key_invalid';
}

export const isRawKey = (k: TelemetryEntityKind, key: string): boolean => k.keys.mode === 'open' && k.keys.isRaw?.(key) === true;

/** The key cap of an open kind as the dictionary wants it, or undefined (no cap). */
export function maxKeysOf(k: TelemetryEntityKind, tenantId: string): (() => Promise<number | null>) | undefined {
  if (k.keys.mode !== 'open' || !k.keys.maxKeysPerTenant) return undefined;
  const f = k.keys.maxKeysPerTenant;
  return () => f(tenantId);
}

/** The class a tenant's rows of the kind take; a resolver that fails or answers nonsense gives the default class. */
export async function classOfKind(k: TelemetryEntityKind, tenantId: string): Promise<RetentionClass> {
  if ('fixedClass' in k.retention) return k.retention.fixedClass;
  try {
    const d = await k.retention.resolveClass(tenantId);
    return isRetentionClass(d) ? d : DEFAULT_RETENTION_CLASS;
  } catch {
    return DEFAULT_RETENTION_CLASS;
  }
}

/**
 * Loads every `telemetry:entity_kind` contribution once per process (the generated loaders; a module that is not installed
 * contributes nothing). A contribution that fails to load is reported and skipped; the others register.
 */
export function ensureTelemetryKindsLoaded(): Promise<void> {
  loaded ??= (async () => {
    let Logger: { warn: (t: string) => void; error: (t: string) => void } | null = null;
    try {
      Logger = (await import('@kuraykaraaslan-labs/logger')).default;
      const { ext, systemCtx } = await import('@kuraykaraaslan-labs/common/server/extensions/ext');
      const { telemetryEntityKindLoaders } = await import('@kuraykaraaslan-labs/common/server/generated/extensions/telemetry.entity_kind');
      const { loaded: found, failed } = await ext.loadAll<TelemetryEntityKind | { default?: TelemetryEntityKind; TELEMETRY_KIND?: TelemetryEntityKind }>(
        ENTITY_KIND_POINT, systemCtx('telemetry kinds: the store\'s registry, every tenant'), telemetryEntityKindLoaders,
      );
      for (const f of failed) Logger.error(`[telemetry] failed to load kind '${f.contributionId}': ${f.reason}: ${f.message}`);
      for (const { contribution, impl } of found) {
        const k = (impl && 'kind' in impl ? impl : (impl as { default?: TelemetryEntityKind; TELEMETRY_KIND?: TelemetryEntityKind })?.default ?? (impl as { TELEMETRY_KIND?: TelemetryEntityKind })?.TELEMETRY_KIND) as TelemetryEntityKind | undefined;
        if (!k) { Logger.error(`[telemetry] '${contribution.id}' exports no kind; skipped`); continue; }
        try {
          registerTelemetryKind(k);
        } catch (e) {
          Logger.error(`[telemetry] '${contribution.id}': ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } catch (e) {
      // no generated loaders (a test, a tool run): the kinds registered by hand are all there is
      Logger?.warn(`[telemetry] kind contributions not loaded: ${e instanceof Error ? e.message : String(e)}`);
    }
  })();
  return loaded;
}

// ── entity ids from natural keys (00 §0.3) ────────────────────────────────────────────────────────────────────────────────────

/** The root namespace of the store's name-based ids (RFC 4122 v5); each kind derives its own namespace from it. */
export const TELEMETRY_ID_NAMESPACE = '5f2d3b7e-9c1a-4f6e-8b2d-7e1c9a3f5d20';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidV5(namespace: string, name: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(Buffer.concat([ns, Buffer.from(name, 'utf8')])).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const h = hash.subarray(0, 16).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

const kindNamespaces = new Map<string, string>();

/**
 * The entity id of a natural key (`fx.currency` + `TRY`, `fleet_node` + a node id, an OTel series + metric and labels): a uuid v5 in the
 * kind's own namespace, so two kinds never produce the same id and the same key always maps to the same id. A key that already is a uuid
 * is used as it is.
 */
export function entityIdOf(kind: string, naturalKey: string): string {
  if (UUID_RE.test(naturalKey)) return naturalKey.toLowerCase();
  let ns = kindNamespaces.get(kind);
  if (!ns) {
    ns = uuidV5(TELEMETRY_ID_NAMESPACE, kind);
    kindNamespaces.set(kind, ns);
  }
  return uuidV5(ns, naturalKey);
}

// ── kind ids (ED-10) ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const kindIds = new Map<string, number>();
const kindNames = new Map<number, string>();

/** The small id of a kind as the rows carry it, from the process cache; undefined until `resolveKindId` ran for it. */
export const cachedKindId = (kind: string): number | undefined => kindIds.get(kind);
export const cachedKindName = (kindId: number): string | undefined => kindNames.get(kindId);

/**
 * The id of a kind in `telemetry_kinds`, created on first use (ids are never reused). Runs in the caller's transaction (the table
 * has no tenant rows and no RLS; app roles may read and insert it) and caches the answer for the process.
 */
export async function resolveKindId(db: { query(sql: string, params?: unknown[]): Promise<unknown> }, kind: string): Promise<number> {
  const hit = kindIds.get(kind);
  if (hit !== undefined) return hit;
  await db.query(`INSERT INTO "telemetry_kinds" ("kind") VALUES ($1) ON CONFLICT ("kind") DO NOTHING`, [kind]);
  const rows = (await db.query(`SELECT "kindId" FROM "telemetry_kinds" WHERE "kind" = $1`, [kind])) as Array<{ kindId: number }> | { rows: Array<{ kindId: number }> };
  const id = Number((Array.isArray(rows) ? rows : rows.rows)[0]?.kindId);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`[telemetry] kind "${kind}" has no id in telemetry_kinds`);
  kindIds.set(kind, id);
  kindNames.set(id, kind);
  return id;
}

/** Tests: forget every kind and the load state. */
export function resetTelemetryKindsForTests(): void {
  kinds.clear();
  kindIds.clear();
  kindNames.clear();
  loaded = null;
}
