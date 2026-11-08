/**
 * How a deploy run behaves, derived from the environment. Pure (reads only the
 * map it is given, never `process.env` itself, never `env`) so `db.utils` and the
 * deploy script can use it before env validation and the tests can pass any map.
 *
 * The process role is `FLEET_ROLE` (`single` | `node` | `fleet`; unset = `single`):
 *
 * | | schema mode default | seed default | owner URL |
 * |---|---|---|---|
 * | `single` (dev, Vercel, compose) | `synchronize` (today's behaviour) | `always` (fresh DB only) | falls back to `DATABASE_URL_ADMIN` / `DATABASE_URL` |
 * | `node`, `fleet` | `migrate` | `never` | `DATABASE_URL_UNPOOLED` only (via `migrate` mode) |
 *
 * `DB_DEPLOY_MODE` and `DB_DEPLOY_SEED` override the role default, so an operator
 * who needs the old behaviour on a node asks for it explicitly.
 */

export type FleetRole = 'single' | 'node' | 'fleet';
export type SchemaMode = 'synchronize' | 'migrate';
export type SeedMode = 'auto' | 'always' | 'never';

type EnvMap = Readonly<Record<string, string | undefined>>;

const SCHEMA_MODES: readonly SchemaMode[] = ['synchronize', 'migrate'];
const SEED_MODES: readonly SeedMode[] = ['auto', 'always', 'never'];
const ROLES: readonly FleetRole[] = ['single', 'node', 'fleet'];

/** Default lock wait: long enough for a slow migration run, finite so a stuck holder cannot hang a deploy forever. */
export const DEFAULT_LOCK_TIMEOUT_MS = 10 * 60 * 1000;

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function oneOf<T extends string>(name: string, value: string, allowed: readonly T[]): T {
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(`[db-deploy] ${name} must be one of ${allowed.join('|')}, got "${value}"`);
}

/** The process role; an unknown value fails closed rather than being read as `single`. */
export function resolveFleetRole(env: EnvMap): FleetRole {
  const raw = clean(env.FLEET_ROLE);
  return raw === undefined ? 'single' : oneOf('FLEET_ROLE', raw, ROLES);
}

/** `node` and `fleet` run the control plane or a regional node: they never get the dev conveniences by default. */
export function isFleetManagedRole(role: FleetRole): boolean {
  return role === 'node' || role === 'fleet';
}

export function resolveSchemaMode(env: EnvMap): { mode: SchemaMode; source: 'explicit' | 'role' | 'default' } {
  const explicit = clean(env.DB_DEPLOY_MODE);
  if (explicit !== undefined) return { mode: oneOf('DB_DEPLOY_MODE', explicit, SCHEMA_MODES), source: 'explicit' };
  if (isFleetManagedRole(resolveFleetRole(env))) return { mode: 'migrate', source: 'role' };
  return { mode: 'synchronize', source: 'default' };
}

/** Whether the bootstrap seed (known-password demo accounts) may run on an empty database. */
export function resolveSeedEnabled(env: EnvMap): boolean {
  const raw = clean(env.DB_DEPLOY_SEED);
  const mode = raw === undefined ? 'auto' : oneOf('DB_DEPLOY_SEED', raw, SEED_MODES);
  if (mode === 'always') return true;
  if (mode === 'never') return false;
  return !isFleetManagedRole(resolveFleetRole(env));
}

export function resolveLockTimeoutMs(env: EnvMap): number {
  const raw = clean(env.DB_DEPLOY_LOCK_TIMEOUT_MS);
  if (raw === undefined) return DEFAULT_LOCK_TIMEOUT_MS;
  const ms = Number(raw);
  if (!Number.isInteger(ms) || ms < 0) {
    throw new Error(`[db-deploy] DB_DEPLOY_LOCK_TIMEOUT_MS must be a non-negative integer, got "${raw}"`);
  }
  return ms;
}

/** Who ran the deploy and for which release, as recorded in the ledger. Both optional: NULL when unknown. */
export function resolveDeployIdentity(env: EnvMap): { actor: string | null; release: string | null } {
  return { actor: clean(env.DB_DEPLOY_ACTOR) ?? null, release: clean(env.RELEASE_VERSION) ?? null };
}

/**
 * Whether the deploy also migrates every dedicated tenant database registered in `tenant_databases` (fanOutDeploy).
 * `node` and `fleet` roles do by default (their tenant databases must follow the release); `single` (dev, Vercel,
 * compose) never has until now, so it stays off unless the operator passes `--tenant-databases`.
 * `--no-tenant-databases` switches it off for any role; giving both flags is a mistake and throws.
 */
export function resolveTenantFanOut(env: EnvMap, argv: readonly string[]): boolean {
  const on = argv.includes('--tenant-databases');
  const off = argv.includes('--no-tenant-databases');
  if (on && off) throw new Error('[db-deploy] --tenant-databases and --no-tenant-databases contradict each other');
  if (on) return true;
  if (off) return false;
  return isFleetManagedRole(resolveFleetRole(env));
}
