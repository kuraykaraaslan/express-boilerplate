import { z } from 'zod';
import {
  And,
  ILike,
  In,
  LessThan,
  LessThanOrEqual,
  MoreThanOrEqual,
  getMetadataArgsStorage,
  type FindOperator,
} from 'typeorm';

/**
 * The list contract every data page's API serves (phase 43, `docs/phases/43-data-tables/README.md`):
 *
 *   ?page=0&pageSize=20&search=acme&sort=createdAt:desc,name:asc&status=OPEN,PAID&createdFrom=2026-10-01&createdTo=2026-10-15
 *   → { data, total }
 *
 * - `page` is 0-based, `pageSize` ≤ 100 (`limit` and `q` stay accepted as aliases).
 * - `sort` names public fields only; each maps to an entity property in the endpoint's `sortable` map. Any other
 *   field is a 400, so no column name from the client ever reaches SQL. A tiebreak on the primary key keeps paging
 *   stable.
 * - Filters are named parameters declared per endpoint with the `listFilter` helpers: a list joins with commas, a date
 *   range is `<id>From` / `<id>To` (whole days, UTC), a number range `<id>Min` / `<id>Max`, a flag `true` / `false`.
 *
 * Dependency-light: Zod and TypeORM operators only. Tenancy and authorization stay with the route
 * (`authorizeRequest`) and the service (`withTenantRepositoryFor`).
 */

export type SortDirection = 'asc' | 'desc';
export type ListSort<F extends string = string> = { field: F; dir: SortDirection }[];

/**
 * `sort=a:asc,b:desc` parsed against the allowed public fields. `aliases` keeps an endpoint's older sort words
 * working (`popular` → `views:desc`); an alias is replaced whole before the parse.
 */
export function sortParam<F extends string>(fields: readonly F[], aliases: Record<string, string> = {}) {
  return z
    .string()
    .trim()
    .max(200)
    .transform((input, ctx): ListSort<F> => {
      const raw = Object.prototype.hasOwnProperty.call(aliases, input) ? aliases[input] : input;
      const out: ListSort<F> = [];
      for (const part of raw.split(',').map((p) => p.trim()).filter(Boolean)) {
        const [field, dirRaw = 'asc'] = part.split(':');
        const dir = dirRaw.toLowerCase();
        if (!(fields as readonly string[]).includes(field) || (dir !== 'asc' && dir !== 'desc')) {
          ctx.addIssue({
            code: 'custom',
            message: `Cannot sort by "${part}". Sortable fields: ${fields.join(', ') || 'none'}.`,
          });
          return z.NEVER;
        }
        if (!out.some((s) => s.field === field)) out.push({ field: field as F, dir });
      }
      return out.slice(0, 3);
    });
}

const csv = z
  .string()
  .trim()
  .max(2000)
  .transform((s) => s.split(',').map((v) => v.trim()).filter(Boolean));

// A real calendar day: `2026-13-40` has the shape but is no date, and would reach the query as an Invalid Date.
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((d) => {
    const t = Date.parse(`${d}T00:00:00.000Z`);
    return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
  }, 'Not a calendar day');

/** Zod pieces for declaring an endpoint's filters. Every one is optional. */
export const listFilter = {
  /** One or more values of an enum (`status=OPEN,PAID`); takes a tuple or a Zod enum's `.options`. */
  oneOf: <const V extends string>(values: readonly V[]) =>
    csv.pipe(z.array(z.enum(values as unknown as [V, ...V[]])).max(values.length)).optional(),
  /** One or more ids (opaque keys): `ownerId=…,…`. */
  ids: () => csv.pipe(z.array(z.string().min(1).max(100)).max(100)).optional(),
  /** One or more uuids; anything else is a 400 (a uuid column compared with junk would be a database error). */
  uuids: () => csv.pipe(z.array(z.string().uuid()).max(100)).optional(),
  /** A single free value (exact match). */
  value: () => z.string().trim().min(1).max(200).optional(),
  /** `YYYY-MM-DD`, for `<id>From` / `<id>To`. */
  day: () => day.optional(),
  /** A number, for `<id>Min` / `<id>Max` or an exact value. */
  number: () => z.coerce.number().finite().optional(),
  /** `true` / `false`. */
  flag: () =>
    z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
};

/** `page`, `pageSize`, `search`: the part every list shares. */
export const ListPageSchema = z.object({
  page: z.coerce.number().int().min(0).max(100_000).default(0),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
});

/**
 * An endpoint's list schema: the shared page fields, a whitelisted `sort` (with its default) and the endpoint's
 * filters.
 *
 *   const SORTABLE = { name: 'name', createdAt: 'createdAt', amount: 'totalAmount' } as const;
 *   export const ListOrdersQuery = listQuerySchema({
 *     sortable: SORTABLE,
 *     defaultSort: 'createdAt:desc',
 *     filters: { status: listFilter.oneOf(ORDER_STATUSES), createdFrom: listFilter.day(), createdTo: listFilter.day() },
 *   });
 */
export function listQuerySchema<
  const S extends Record<string, string>,
  F extends z.ZodRawShape = Record<string, never>,
>(opts: {
  sortable: S;
  /** `field:dir`, or a comma list for a secondary order (`isDefault:desc,code:asc`); parsed against the whitelist. */
  defaultSort?: `${Extract<keyof S, string>}:${SortDirection}` | `${Extract<keyof S, string>}:${SortDirection},${string}`;
  /** Older sort words of this endpoint and what they mean (`{ popular: 'views:desc' }`). */
  sortAliases?: Record<string, string>;
  /** An endpoint that always served bigger pages keeps them (default 20, at most 100). */
  pageSize?: { default: number; max: number };
  /** A 1-based endpoint stays 1-based (its page passes `pageBase: 1` to useListFetcher). Default 0. */
  pageBase?: 0 | 1;
  filters?: F;
}) {
  const fields = Object.keys(opts.sortable) as Extract<keyof S, string>[];
  const sort = sortParam(fields, opts.sortAliases);
  return ListPageSchema.extend({
    page: z.coerce.number().int().min(opts.pageBase ?? 0).max(100_000).default(opts.pageBase ?? 0),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(opts.pageSize?.max ?? 100)
      .default(opts.pageSize?.default ?? 20),
    // prefault: the default is a raw `field:dir` string that still goes through the whitelist parse.
    sort: opts.defaultSort ? sort.prefault(opts.defaultSort) : sort.optional(),
    ...(opts.filters ?? ({} as F)),
  });
}

/**
 * Reads a route's query string into `schema`. Keys are the schema's own; `limit` → `pageSize` and `q` → `search`
 * are accepted as aliases (older clients). Missing keys are left out so defaults apply.
 */
export function readListQuery<S extends z.ZodObject<z.ZodRawShape>>(
  searchParams: URLSearchParams,
  schema: S,
  aliases: Record<string, string> = { pageSize: 'limit', search: 'q' },
): z.infer<S> {
  const raw: Record<string, string> = {};
  for (const key of Object.keys(schema.shape)) {
    const v = searchParams.get(key) ?? (aliases[key] ? searchParams.get(aliases[key]) : null);
    if (v !== null && v !== '') raw[key] = v;
  }
  return schema.parse(raw);
}

type OrderDirection = 'ASC' | 'DESC';
type OrderValue = OrderDirection | { direction: OrderDirection; nulls: 'LAST' } | { [k: string]: OrderValue };

// Entity class → its property paths that can hold null: its own and inherited columns, and `relation.column` one level
// down (every column of a relation that may be missing).
const nullablePaths = new WeakMap<object, Set<string>>();

function ownAndInherited<T extends { target: unknown }>(items: readonly T[], entity: object): T[] {
  const chain: unknown[] = [];
  for (let t: unknown = entity; typeof t === 'function' && t !== Function.prototype; t = Object.getPrototypeOf(t)) chain.push(t);
  return items.filter((item) => chain.includes(item.target));
}

function readNullablePaths(entity: object): Set<string> {
  const known = nullablePaths.get(entity);
  if (known) return known;
  const storage = getMetadataArgsStorage();
  const isNullable = (c: (typeof storage.columns)[number]) => c.options.nullable === true || c.mode === 'deleteDate';
  const out = new Set<string>();
  for (const c of ownAndInherited(storage.columns, entity)) if (isNullable(c)) out.add(c.propertyName);
  for (const r of ownAndInherited(storage.relations, entity)) {
    const related = typeof r.type === 'function' ? (r.type as () => unknown)() : undefined;
    if (typeof related !== 'function') continue;
    const missing = r.options.nullable !== false;
    for (const c of ownAndInherited(storage.columns, related)) {
      if (missing || isNullable(c)) out.add(`${r.propertyName}.${c.propertyName}`);
    }
  }
  nullablePaths.set(entity, out);
  return out;
}

/**
 * The TypeORM `order` for a parsed sort: public field → entity property (a dotted path orders by a relation,
 * `customer.name`), then the tiebreak (primary key) so equal values page in a stable order.
 *
 * With the `entity`, a sorted column that can hold null puts its empty rows last in both directions (`NULLS LAST`), the
 * DataTable's own rule (Postgres would put them first when descending). Only nullable columns get the clause: on a NOT
 * NULL column it would only stop an index from serving the order.
 */
export function toOrder(
  sort: ListSort | undefined,
  sortable: Record<string, string>,
  tiebreak: Record<string, OrderDirection>,
  entity?: object,
): Record<string, OrderValue> {
  const order: Record<string, OrderValue> = {};
  const nullable = entity ? readNullablePaths(entity) : undefined;
  const put = (path: string, value: OrderValue) => {
    const parts = path.split('.');
    let node: Record<string, OrderValue> = order;
    for (let i = 0; i < parts.length - 1; i++) {
      const next = node[parts[i]];
      if (typeof next !== 'object') node[parts[i]] = {};
      node = node[parts[i]] as Record<string, OrderValue>;
    }
    const leaf = parts[parts.length - 1];
    if (!(leaf in node)) node[leaf] = value;
  };
  for (const s of sort ?? []) {
    const path = sortable[s.field];
    const direction: OrderDirection = s.dir === 'desc' ? 'DESC' : 'ASC';
    put(path, nullable?.has(path) ? { direction, nulls: 'LAST' } : direction);
  }
  for (const [k, dir] of Object.entries(tiebreak)) put(k, dir);
  return order;
}

/** Escapes `%`, `_` and `\` so user text matches literally inside a LIKE pattern. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** `ILike('%text%')` with the text escaped. */
export function containsText(search: string): FindOperator<string> {
  return ILike(`%${escapeLike(search)}%`);
}

/**
 * A `where` that matches `search` in any of `columns` (TypeORM ORs the array), each branch keeping `base`.
 * Without a search it is `base` itself.
 */
export function searchWhere<W extends Record<string, unknown>>(
  base: W,
  search: string | undefined,
  columns: readonly string[],
): W | W[] {
  if (!search || columns.length === 0) return base;
  const like = containsText(search);
  return columns.map((c) => ({ ...base, [c]: like }) as W);
}

/**
 * `In(values)` for a non-empty list, else nothing. A single value (an older caller passing `status: 'OPEN'` straight to
 * the service) counts as a list of one — never spread into characters.
 */
export function inList<V>(values: readonly V[] | V | undefined | null): FindOperator<V> | undefined {
  if (values === undefined || values === null || values === '') return undefined;
  const list = Array.isArray(values) ? (values as readonly V[]) : [values as V];
  return list.length ? In([...list]) : undefined;
}

/** `YYYY-MM-DD` of the calendar day after `dateKey`. */
function nextDayKey(dateKey: string): string {
  const [y, m, d] = dateKey.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + 1)).toISOString().slice(0, 10);
}

/** How far `timeZone`'s wall clock is ahead of UTC at the instant `ms` (DST-aware); 0 for an unknown zone. */
function zoneOffsetMs(ms: number, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(ms));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    return wall - Math.floor(ms / 1000) * 1000;
  } catch {
    return 0;
  }
}

/**
 * The instant `dateKey` 00:00 begins in `timeZone` (UTC without a zone or for an unknown one). Two passes settle the
 * offset across a DST change; a midnight that a DST jump skips resolves to the first instant of that day.
 */
function zonedDayStart(dateKey: string, timeZone?: string): Date {
  const utcMidnight = new Date(`${dateKey.slice(0, 10)}T00:00:00.000Z`).getTime();
  if (!timeZone || timeZone === 'UTC') return new Date(utcMidnight);
  let guess = utcMidnight - zoneOffsetMs(utcMidnight, timeZone);
  guess = utcMidnight - zoneOffsetMs(guess, timeZone);
  return new Date(guess);
}

/**
 * `dayRange`'s two instants, for a query built by hand (SQL, a query builder): `start` = `from` 00:00 (inclusive),
 * `end` = 00:00 of the day after `to` (exclusive), in `timeZone`'s days (UTC without one). Either is undefined when
 * its day is.
 */
export function dayBounds(from: string | undefined, to: string | undefined, timeZone?: string): { start?: Date; end?: Date } {
  return {
    start: from ? zonedDayStart(from, timeZone) : undefined,
    end: to ? zonedDayStart(nextDayKey(to), timeZone) : undefined,
  };
}

/**
 * Whole days: `from` 00:00 inclusive up to the day after `to`, exclusive — UTC days, or the days of `timeZone` (an IANA
 * name, e.g. the tenant's `timezone` setting) when given, so a filter on "1 March" matches what the list shows as
 * 1 March for that tenant.
 */
export function dayRange(from: string | undefined, to: string | undefined, timeZone?: string): FindOperator<Date> | undefined {
  const { start, end } = dayBounds(from, to, timeZone);
  if (start && end) return And(MoreThanOrEqual(start), LessThan(end));
  if (start) return MoreThanOrEqual(start);
  if (end) return LessThan(end);
  return undefined;
}

/** `min ≤ value ≤ max`, either end optional. */
export function numberRange(min: number | undefined, max: number | undefined): FindOperator<number> | undefined {
  if (min !== undefined && max !== undefined) return And(MoreThanOrEqual(min), LessThanOrEqual(max));
  if (min !== undefined) return MoreThanOrEqual(min);
  if (max !== undefined) return LessThanOrEqual(max);
  return undefined;
}

/** Drops `undefined` entries so an unset filter never becomes `IS NULL`. */
export function compactWhere<W extends Record<string, unknown>>(where: W): W {
  const out = { ...where };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

/** `{ data, total }`, the list response. */
export type ListResult<T> = { data: T[]; total: number };

// ---------------------------------------------------------------------------
// Lists built in memory (cached sets, merged sources, external APIs): the same parsed query, applied to rows.
// ---------------------------------------------------------------------------

function readPath(row: unknown, path: string): unknown {
  let v: unknown = row;
  for (const part of path.split('.')) v = v == null ? undefined : (v as Record<string, unknown>)[part];
  return v;
}

function compareValues(a: unknown, b: unknown): number {
  const empty = (v: unknown) => v === null || v === undefined || v === '';
  if (empty(a) || empty(b)) return empty(a) === empty(b) ? 0 : empty(a) ? 1 : -1; // empty values last
  if (a instanceof Date || b instanceof Date) return new Date(a as Date).getTime() - new Date(b as Date).getTime();
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Sorts rows by a parsed sort (public fields mapped through `sortable` to row paths); stable, empty values last in
 * either direction. Without a sort the rows keep their order.
 */
export function sortRows<T>(rows: readonly T[], sort: ListSort | undefined, sortable: Record<string, string>): T[] {
  const keys = (sort ?? []).map((s) => ({ path: sortable[s.field], dir: s.dir === 'desc' ? -1 : 1 })).filter((k) => k.path);
  if (keys.length === 0) return [...rows];
  return rows
    .map((row, i) => ({ row, i }))
    .sort((x, y) => {
      for (const k of keys) {
        const a = readPath(x.row, k.path);
        const b = readPath(y.row, k.path);
        const emptyA = a === null || a === undefined || a === '';
        const emptyB = b === null || b === undefined || b === '';
        if (emptyA || emptyB) {
          if (emptyA !== emptyB) return emptyA ? 1 : -1;
          continue;
        }
        const c = compareValues(a, b);
        if (c !== 0) return c * k.dir;
      }
      return x.i - y.i;
    })
    .map((x) => x.row);
}

/** Case-insensitive substring match of `search` in any of the row's `fields` (paths). No search matches all. */
export function matchesSearch(row: unknown, search: string | undefined, fields: readonly string[]): boolean {
  const q = search?.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => {
    const v = readPath(row, f);
    return v !== null && v !== undefined && String(v).toLowerCase().includes(q);
  });
}
