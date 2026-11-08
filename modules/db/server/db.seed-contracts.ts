import { createHash } from 'node:crypto';
import type { DataSource, Repository, FindOptionsWhere, DeepPartial, ObjectLiteral, EntityTarget } from 'typeorm';

// The contract a module's `<module>.seed.ts` is written against: the seed context, the profiles, the deterministic ids and the
// faker. It lives in `db` (the data layer a seed writes to) so that a module can ship its seed without depending on the `seed`
// module, which only RUNS seeds (the runner, the guards, the CLI). `seed` re-exports everything here from seed.context.ts.

/** The deterministic, locale-aware data generator a seed uses (`ctx.faker`); `seed` implements it (SeedFaker). */
export interface SeedFakerApi {
  /** Integer in [min, max]. */
  int(min: number, max: number): number;
  pick<T>(arr: readonly T[]): T;
  bool(p?: number): boolean;
  firstName(): string;
  lastName(): string;
  fullName(): string;
  company(): string;
  email(name?: string): string;
  slug(words?: number): string;
  words(n?: number): string;
  sentence(n?: number): string;
  paragraph(sentences?: number): string;
  /** Price in major units, 2dp, within a band. */
  price(min?: number, max?: number): number;
  phone(): string;
  /** A past date within the last `days` days. */
  pastDate(days?: number): Date;
}

/** Named seed profiles control how much data each module produces. */
export type SeedProfile = 'minimal' | 'demo' | 'stress';

/** Per-profile multiplier for "how many rows" decisions in seeders. */
export const PROFILE_SCALE: Record<SeedProfile, number> = { minimal: 1, demo: 5, stress: 100 };

// ============================================================================
// Deterministic ids
// ----------------------------------------------------------------------------
// Shared across every module seed so cross-references (a review's userId, an
// invoice's orderId, …) stay stable across re-runs. They are plain uuids — the
// tenant DBs store these as columns without cross-database FK constraints, so a
// matching row does not need to physically exist in another database.
// ============================================================================

export const SEED_USER_ID = 'a0000000-0000-4000-8000-000000000001';
export const SEED_ADMIN_USER_ID = 'a0000000-0000-4000-8000-000000000002';
/**
 * The canonical seeded sale's id for the default demo tenant (ACME) only. The order is a tenant-owned row and
 * `orderId` is its primary key, so one id shared by every tenant made each tenant's seed move the same row to
 * itself. Use `seedOrderId(tenantId)` for the id of the seeded tenant's own order.
 */
export const SEED_ORDER_ID = 'b0000000-0000-4000-8000-000000000001';

/**
 * The tenant whose seed order keeps the historic id `SEED_ORDER_ID` (ACME), so its existing rows are still found. ACME's id since phase 46,
 * common's `SEED_TENANT_ID` (a literal here, not an import: many seed tests mock tenant-constants with ROOT only; a test keeps the two equal).
 * `tenant:rekey` moves ACME's rows to it with their ids, so the moved order is still the one found here.
 */
export const SEED_ORDER_ID_TENANT_ID = '00000000-0000-4000-a000-000000000001';

/**
 * The id of the seeded tenant's canonical order (`SO-2026-00001`): `SEED_ORDER_ID` for ACME, otherwise a
 * deterministic uuid derived from the tenant, so every tenant gets its own primary key and a re-run finds it.
 */
export function seedOrderId(tenantId: string): string {
  if (tenantId === SEED_ORDER_ID_TENANT_ID) return SEED_ORDER_ID;
  const h = createHash('sha256').update(`seed-order:${tenantId}`).digest('hex');
  return `b${h.slice(0, 7)}-${h.slice(7, 11)}-4${h.slice(11, 14)}-8${h.slice(14, 17)}-${h.slice(17, 29)}`;
}

/**
 * Area codes for `fictionalPhone`. NANP reserves 555-0100 … 555-0199 for fictional use in every area code, so
 * `+1 <area> 555-01NN` is never a real subscriber, yet it is a valid number to libphonenumber (reverse lookup,
 * E.164 checks). 60 areas × 100 numbers give every seed its own block of unique numbers.
 */
const FICTIONAL_AREA_CODES = [
  '202', '212', '213', '214', '215', '216', '217', '218', '219', '224', '225', '228', '229', '231', '234', '239', '240', '248', '251', '252',
  '253', '254', '256', '260', '262', '267', '269', '270', '272', '276', '281', '301', '302', '303', '304', '305', '307', '308', '309', '310',
  '312', '313', '314', '315', '316', '317', '318', '319', '320', '321', '323', '325', '330', '331', '334', '336', '337', '339', '347', '351',
] as const;

/** How many distinct numbers `fictionalPhone` can return (n in [0, FICTIONAL_PHONE_COUNT)). */
export const FICTIONAL_PHONE_COUNT = FICTIONAL_AREA_CODES.length * 100;

/**
 * The n-th reserved fictional phone number, in E.164: `+1<area>55501NN`. Seeds use it instead of real-looking
 * numbers. Blocks of n, so numbers stay unique across seeds:
 *   0–99 named demo people and lines (literals in the seeds) · 100–199 hr_recruitment candidates ·
 *   1000–1399 contact filler companies · 1400–2199 contact filler people · 2200–2699 crm_lead filler ·
 *   2700–3199 bookings filler · 3200–3599 user filler · 4000–5999 the faker's random phones.
 */
export function fictionalPhone(n: number): string {
  const i = ((Math.trunc(n) % FICTIONAL_PHONE_COUNT) + FICTIONAL_PHONE_COUNT) % FICTIONAL_PHONE_COUNT;
  return `+1${FICTIONAL_AREA_CODES[Math.floor(i / 100)]}55501${String(i % 100).padStart(2, '0')}`;
}

/** A column holding a seed order reference: `id` (uuid/varchar equal to it), `text` or `json` (containing it). */
export type SeedOrderRefColumn = readonly [table: string, column: string, kind?: 'id' | 'text' | 'json'];

/**
 * One-time correction of rows written before the seed order id was tenant-specific: in a tenant other than ACME,
 * the seeded tenant's rows that still carry `SEED_ORDER_ID` (ACME's order) are pointed at `seedOrderId(tenantId)`.
 * Matches only the seeded tenant's own rows (`"tenantId" = ctx.tenantId`), never deletes, and is a no-op for ACME,
 * on a re-run, and on a context without a SQL data source (unit tests).
 */
export async function repointSeedOrderRefs(ctx: Pick<SeedContext, 'ds' | 'tenantId'>, columns: readonly SeedOrderRefColumn[]): Promise<void> {
  const { tenantId } = ctx;
  const ds = ctx.ds as Partial<DataSource> | undefined;
  if (tenantId === SEED_ORDER_ID_TENANT_ID || typeof ds?.query !== 'function') return;
  const target = seedOrderId(tenantId);
  for (const [table, column, kind = 'id'] of columns) {
    if (!/^[a-z_][a-z0-9_]*$/.test(table) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(column)) throw new Error(`repointSeedOrderRefs: bad identifier ${table}.${column}`);
    const sql = kind === 'id'
      ? `UPDATE "${table}" SET "${column}" = $1 WHERE "tenantId" = $2 AND "${column}" = $3`
      : kind === 'text'
        ? `UPDATE "${table}" SET "${column}" = replace("${column}", $3, $1) WHERE "tenantId" = $2 AND strpos("${column}", $3) > 0`
        : `UPDATE "${table}" SET "${column}" = replace("${column}"::text, $3, $1)::jsonb WHERE "tenantId" = $2 AND strpos("${column}"::text, $3) > 0`;
    await ds.query(sql, [target, tenantId, SEED_ORDER_ID]);
  }
}

/**
 * Bag of cross-module references a seed produces for later seeds to consume.
 *
 *   producer:  ctx.refs.productId = product.productId
 *   consumer:  const productId = ctx.refs.productId
 *
 * Common cross-module keys are typed below for discoverability; the index
 * signature lets any module stash its own private references without having to
 * edit this interface (keeps parallel authoring conflict-free).
 */
export interface SeedRefs {
  // identity
  userId?: string;
  adminUserId?: string;
  // store catalog
  categoryId?: string;
  productId?: string;
  planProductId?: string;
  productVariantId?: string;
  bundleId?: string;
  // commerce
  cartId?: string;
  couponCode?: string;
  orderId?: string;
  paymentId?: string;
  subscriptionPlanId?: string;
  shippingMethodId?: string;
  taxClassId?: string;
  // anything else a module wants to publish
  [key: string]: unknown;
}

export interface SeedContext {
  /** Tenant-scoped DataSource — use for entities that have a `tenantId` column. */
  ds: DataSource;
  /** System/global DataSource — use for entities WITHOUT a `tenantId` column. */
  systemDs: DataSource;
  tenantId: string;
  refs: SeedRefs;
  /** Active named profile (minimal/demo/stress) — scales row counts. */
  profile: SeedProfile;
  /**
   * True only in the guarded full-load lane (test database, explicit opt-in). A
   * default seed may add rows that are unsafe for a real tenant (fake legal
   * events, credential-like or runtime rows) only behind `if (ctx.fullLoad)`.
   */
  fullLoad: boolean;
  /** Default locale + country + currencies for locale/country-aware data. */
  locale: string;
  country: string;
  currencies: string[];
  /** Deterministic, locale-aware data generator for realistic seed data. */
  faker: SeedFakerApi;
  /** Profile-scaled count: `ctx.count(2)` → 2 (minimal), 10 (demo), 200 (stress). */
  count(base: number): number;
  /**
   * find-or-create: returns the row matched by `where`, otherwise inserts
   * `create`. Every seed uses this so re-running reuses existing rows by a
   * natural key (slug / code / sku / composite) instead of duplicating them.
   */
  foc<T extends ObjectLiteral>(
    repo: Repository<T>,
    where: FindOptionsWhere<T>,
    create: DeepPartial<T>,
  ): Promise<T>;
  /** Tenant-scoped repository: `ctx.repo(Entity)` ≡ `ctx.ds.getRepository(Entity)`, except an entity pinned to the shared database (`@SharedDatabaseOnly`), which comes from `systemDs` (rows still tenant-keyed). */
  repo<T extends ObjectLiteral>(entity: EntityTarget<T>): Repository<T>;
  /** System-scoped repository for entities without a `tenantId` column. */
  systemRepo<T extends ObjectLiteral>(entity: EntityTarget<T>): Repository<T>;
  /**
   * Run `fn` with `tenantId` in the tenant query context (`runWithTenant`, the
   * same context the API dispatcher and the cron jobs open). The runner already
   * runs every seeder inside `ctx.tenantId`'s context; a seeder that writes rows
   * OWNED BY ANOTHER tenant (synthetic tenants, platform rows) wraps those writes
   * in this, per row or per tenant, so they carry their owner's context and not
   * the seeded tenant's. Never a bypass. `foc` does it by itself for a row whose
   * `create`/`where` names its `tenantId`.
   */
  asTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T>;
  /** Structured progress line. */
  log(message: string): void;
}

/** Signature every module's `<module>.seed.ts` exports as `seed<Module>`. */
export type ModuleSeeder = (ctx: SeedContext) => Promise<void>;

/**
 * What a module default-exports to the `db:seeder` extension point: one entry of the seed runner's list. A module the runner
 * cannot import (an add-on package, ADR-0013) is seeded this way. `name` is the seeder's unique name (the module id), `tier`
 * orders it with the built-in seeders (a tier runs after every lower one), `deps` names the seeders it reads, which must sit in
 * an earlier tier, and `run` is the module's `seed<Module>` function.
 */
export interface SeederContribution {
  name: string;
  tier: number;
  deps?: string[];
  run: ModuleSeeder;
}
