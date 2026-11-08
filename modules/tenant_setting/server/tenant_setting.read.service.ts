import 'reflect-metadata';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { ROOT_TENANT_ID, isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { Setting as SettingEntity } from './entities/setting.entity';
import { Setting } from './tenant_setting.types';
import redis from '@kuraykaraaslan-labs/redis';
import { getCacheKey, getFromCache, deleteCache, readWriteVersion, fillAllUnlessWritten } from './tenant_setting.cache';
import { parseRow, parseRows, decryptValue } from './tenant_setting.crypto';
import { SettingSchema } from './tenant_setting.types';
import { isLedgerProjectionKey } from './tenant_setting.write.maker-checker';
import { levelFollowOf, makeLevelSides, resolveSettingLevel, tenantHasGroup, type ResolvedSettingLevel, type SettingSide } from './tenant_setting.levels';
import { SETTING_LEVEL_KEY_PREFIX } from './tenant_setting.level.setting.keys';
import { SETTING_LEVELS_BY_MODULE } from '@kuraykaraaslan-labs/common/server/setting-keys.catalog';

// ── Platform default → tenant override inheritance ───────────────────────
// When a tenant doesn't have a key, fall back to the ROOT_TENANT_ID default —
// except for the ledger projections (`module.<id>.enabled`, the community-plugin
// install keys): those say what this tenant installed, and ROOT's own install is
// nobody else's default (see isLedgerProjectionKey).
// Nor a plugin's secrets (`plugin_secret:<pluginId>:<key>`): the operator's own credentials for a plugin installed in
// ROOT must never be sent by the same plugin running for another tenant (which may point it at its own endpoint).
// Nor a tenant's own admission decision: `allowSelfRegistration` on ROOT opens the PLATFORM sign-up, and must not open
// sign-up into every tenant that never chose it (auth.registration.ts).
// Nor marketplace's opt-ins (2026-10-27): `marketplaceAutoUpdate` on ROOT would update every tenant's plugins unasked, and
// `marketplaceAllowBlockScripts` would run third-party script on every tenant's public pages. Nor a tenant's own export
// choices (`exportAuditLogCap`, `exportMinIntervalMinutes`): ROOT's export of its own data is no other tenant's default.
// Nor invoice's e-Arşiv integration (MS-06): ROOT's portal login is the operator's own tax identity, and a tenant that set
// none must not issue its invoices under it.

/**
 * Phase 53.0 (2026-10-31): keys that name the tenant's own legal identity or its own destination, never the operator's
 * (docs/audits/2026-10-31-root-credential-fallback.md). A tenant that set none must fail visibly, not act as the operator:
 * - invoice's issuer block and seal: without them a tenant's invoice carried the operator's legal name, tax number and IBAN
 *   (`invoice.create.service.ts` only checks that a name and a tax number exist) and its XML was signed with the operator's
 *   seal (`invoice.signature.service.ts` → `ESignatureDocumentService`);
 * - consent_registry_iys's account: a tenant's customers' consents were submitted under the operator's İYS brand code;
 * - on_call's Slack: a tenant's incident pages were posted into the operator's channel, and actions signed with the
 *   operator's secret were accepted for it.
 */
export const TENANT_IDENTITY_KEYS: readonly string[] = [
  'companyLegalName', 'companyTaxId', 'companyTaxOffice', 'euVatNumber',
  'companyAddressLine1', 'companyAddressLine2', 'companyCity', 'companyPostalCode', 'companyProvince', 'companyCountryCode',
  'companyPhone', 'companyEmail', 'companyWebsite', 'companyLogoUrl', 'companyIban',
  'invoiceSigningKeyPem', 'invoiceSigningCertPem',
  'iysCode', 'iysBrandCode', 'iysUsername', 'iysPassword', 'iysBaseUrl',
  'onCallSlackWebhookUrl', 'onCallSlackSigningSecret',
];

const TENANT_OWN_KEYS: ReadonlySet<string> = new Set([
  'allowSelfRegistration', 'marketplaceAutoUpdate', 'marketplaceAllowBlockScripts', 'exportAuditLogCap', 'exportMinIntervalMinutes',
  'earsivIntegrator', 'earsivIntegratorUsername', 'earsivIntegratorPassword', 'earsivIntegratorBaseUrl', 'earsivIntegratorSandbox',
  // ai_firewall (phase 55 01 §1.1, §1.7): ROOT's own kill switch stops ROOT's actions only (every tenant at once is the platform's
  // switch); ROOT's default mode is the platform's runs' default, and ROOT's retention keeps the platform's rows: neither is any other
  // tenant's value (ROOT's 7 days would otherwise purge the evidence of every tenant that set none). Unset = the module's defaults.
  'aiFirewallKillSwitch', 'aiFirewallDefaultMode', 'aiFirewallRetentionDays',
  // 02.6: a tenant's hard block of sign-ups is its own opt-in; ROOT's opts in the platform's runs only.
  'aiFirewallSignupHardBlock',
  ...TENANT_IDENTITY_KEYS,
]);
// Nor a connector's OAuth client credentials (MS-20): ROOT's are the operator's own and must never be sent for a tenant.
// Nor ROOT's choice of setting levels (`settingLevel.*`, phase 53): it is read from ROOT's map by the level resolver, not a value.
// Nor the AI firewall's per-action modes (`aiFirewallMode:<actionId>`, phase 55 01 §1.1): a tenant's Auto is only its own confirmed choice.
const NO_INHERIT_PREFIXES: readonly string[] = [
  'plugin_secret:', 'integrationsClientId:', 'integrationsClientSecret:', SETTING_LEVEL_KEY_PREFIX, 'aiFirewallMode:',
];
const inheritsFromRoot = (key: string): boolean =>
  !isLedgerProjectionKey(key) && !NO_INHERIT_PREFIXES.some((p) => key.startsWith(p)) && !TENANT_OWN_KEYS.has(key);

// ── Setting levels (phase 53, tenant_setting.levels.ts) ──────────────────
// A key of a module's group follows the level ROOT chooses for that module and is read from one side for the whole group;
// every other key keeps the rule above. Both maps are already loaded for a key lookup, so a level costs no round trip.

/** The side `key` is read from for `tenantId`, given its own map and ROOT's (null for ROOT itself). */
function sidesFor<T extends { value: string }>(
  tenantId: string, own: ReadonlyMap<string, T>, root: ReadonlyMap<string, T> | null,
): (key: string) => SettingSide {
  const levelSide = makeLevelSides(tenantId, own, root);
  return (key) => {
    const side = levelSide(key);
    if (side !== undefined) return side;
    if (own.has(key)) return 'own';
    return root && inheritsFromRoot(key) && root.has(key) ? 'root' : null;
  };
}

const pick = (side: SettingSide, key: string, own: ReadonlyMap<string, Setting>, root: ReadonlyMap<string, Setting> | null) =>
  (side === 'own' ? own.get(key) : side === 'root' ? root?.get(key) : undefined) ?? null;

async function resolveValue(tenantId: string, key: string): Promise<SettingEntity | null> {
  if (!isRootTenant(tenantId) && levelFollowOf(key)) {
    // A level key's side depends on ROOT's level rows and, for tenant_first, on the tenant's whole group. A masked read never
    // touches the cache, so both tenants' rows come straight from their own scopes, as stored (the caller masks the answer).
    const rows = (id: string) => withTenantRepositoryFor(id, SettingEntity, (repo) => repo.find({ where: { tenantId: id } }));
    const own = new Map((await rows(tenantId)).map((r) => [r.key, r]));
    const root = new Map((await rows(ROOT_TENANT_ID)).map((r) => [r.key, r]));
    const side = sidesFor(tenantId, own, root)(key);
    return (side === 'own' ? own.get(key) : side === 'root' ? root.get(key) : undefined) ?? null;
  }
  const row = await withTenantRepositoryFor(tenantId, SettingEntity, (repo) => repo.findOne({ where: { tenantId, key } }));
  if (row) return row;
  if (isRootTenant(tenantId) || !inheritsFromRoot(key)) return null;
  // Fallback to platform default — read in the ROOT tenant's own scope, since
  // those rows are the root tenant's (docs/phases/10-db Faz 3).
  return withTenantRepositoryFor(ROOT_TENANT_ID, SettingEntity, (repo) =>
    repo.findOne({ where: { tenantId: ROOT_TENANT_ID, key } }));
}

// Reads the tenant's rows from the database and refills its full map. Shared by
// getAll's miss path and loadMaps so neither pays a second redis GET. The fill is fenced against a write that
// overlapped the query (tenant_setting.cache.ts), which would otherwise be undone for the cache's TTL.
// tenant_setting.05: the cached map holds the values AS STORED (a secret stays ciphertext under the tenant's data key);
// they are decrypted after every read, so Redis never holds a plaintext secret.
async function loadAll(tenantId: string): Promise<Setting[]> {
  const since = await readWriteVersion(tenantId);
  const stored = await readStored(tenantId);
  await fillAllUnlessWritten(tenantId, JSON.stringify(stored), since);
  return decryptList(stored);
}

/** The tenant's rows as stored (a secret stays ciphertext), straight from its own scope. */
async function readStored(tenantId: string): Promise<Setting[]> {
  const settings = await withTenantRepositoryFor(tenantId, SettingEntity, (repo) => repo.find({ where: { tenantId } }));
  return settings.map((row) => SettingSchema.parse({ ...row }));
}

/** The stored (cached) list with its sensitive values decrypted in the scope of each row's own tenant. */
function decryptList(list: Setting[]): Promise<Setting[]> {
  return Promise.all(list.map(async (s) => ({ ...s, value: await decryptValue(s.tenantId, s.key, s.value) })));
}

function parseCachedList(raw: string | null | undefined): Setting[] | null {
  if (!raw) return null;
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : null;
  } catch { return null; }
}

export async function getAll(tenantId: string, masked = false): Promise<Setting[]> {
  if (masked) {
    // Masked reads never touch the cache, which only holds decrypted values.
    const settings = await withTenantRepositoryFor(tenantId, SettingEntity, (repo) => repo.find({ where: { tenantId } }));
    return parseRows(settings, true);
  }
  const cacheKey = getCacheKey(tenantId);
  const cached = await getFromCache(cacheKey);
  if (cached) {
    const list = parseCachedList(cached);
    if (list) return decryptList(list);
    await deleteCache(cacheKey);
  }
  return loadAll(tenantId);
}

type SettingMaps = { own: Map<string, Setting>; root: Map<string, Setting> | null };

// Key lookups are served from the full per-tenant map plus the ROOT map, never
// from per-key entries. Most settings have no row (their defaults live in code),
// so a per-key cache could only ever cache hits and every miss went to Postgres
// (twice for a non-root tenant: own row, then the ROOT fallback). A full map
// answers "absent" as well as "present", and every write path already drops the
// written tenant's `:all`, so ROOT writes reach tenants without copying ROOT
// values into tenant keys. One MGET covers both maps.
async function loadMaps(tenantId: string): Promise<SettingMaps> {
  const root = isRootTenant(tenantId);
  const keys = root ? [getCacheKey(tenantId)] : [getCacheKey(tenantId), getCacheKey(ROOT_TENANT_ID)];
  let cached: (string | null)[] = [];
  try { cached = await redis.mget(...keys); } catch { cached = []; }

  const load = async (id: string, raw: string | null | undefined): Promise<Setting[]> => {
    const list = parseCachedList(raw);
    if (list) return decryptList(list);
    if (raw) await deleteCache(getCacheKey(id));
    return loadAll(id);
  };
  // Sequential on purpose: a cold fill is rare, and two parallel tenant blocks
  // would hold two pool connections at once.
  const ownList = await load(tenantId, cached[0]);
  const rootList = root ? null : await load(ROOT_TENANT_ID, cached[1]);
  const toMap = (list: Setting[]) => new Map(list.map((s) => [s.key, s]));
  return { own: toMap(ownList), root: rootList ? toMap(rootList) : null };
}

/** Both maps straight from the database (no cache read, no fill). */
async function readMaps(tenantId: string): Promise<SettingMaps> {
  const toMap = (list: Setting[]) => new Map(list.map((s) => [s.key, s]));
  const own = toMap(await decryptList(await readStored(tenantId)));
  const root = isRootTenant(tenantId) ? null : toMap(await decryptList(await readStored(ROOT_TENANT_ID)));
  return { own, root };
}

export async function getByKey(tenantId: string, key: string, masked = false): Promise<Setting | null> {
  if (masked) {
    const row = await resolveValue(tenantId, key);
    return row ? parseRow(row, true) : null;
  }
  const { own, root } = await loadMaps(tenantId);
  return pick(sidesFor(tenantId, own, root)(key), key, own, root);
}

/**
 * `fromDatabase` (D270): the maps are read from the database alone, the map cache neither read nor filled. For a guarded cache built
 * from settings (auth_abac's runtime settings): its refill must read rows no older than the generation it seals with, which the plain
 * map (120 s TTL, invalidated best effort) cannot promise. Same resolution either way (ROOT inheritance, setting levels).
 */
export async function getByKeys(tenantId: string, keys: string[], opts?: { fromDatabase?: boolean }): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  if (!keys.length) return result;
  const { own, root } = opts?.fromDatabase ? await readMaps(tenantId) : await loadMaps(tenantId);
  const sideOf = sidesFor(tenantId, own, root);
  for (const key of keys) {
    const hit = pick(sideOf(key), key, own, root);
    if (hit) result[key] = hit.value;
  }
  return result;
}

/**
 * 04-tenant-setting 1.2: what this tenant inherits from ROOT, `key -> value` (decrypted; the caller masks): every ROOT row the tenant has no own row
 * for and that `getByKey` would answer from ROOT (`inheritsFromRoot`, or the module's setting level). Empty on ROOT itself. One MGET for both
 * maps, like every key lookup.
 */
export async function getInheritedFromRoot(tenantId: string): Promise<Record<string, string>> {
  if (isRootTenant(tenantId)) return {};
  const { own, root } = await loadMaps(tenantId);
  const sideOf = sidesFor(tenantId, own, root);
  const inherited: Record<string, string> = {};
  for (const [key, row] of root ?? []) {
    if (!own.has(key) && sideOf(key) === 'root') inherited[key] = row.value;
  }
  return inherited;
}

/**
 * Phase 53: `tenantId`'s level for `moduleId` and where it comes from (the operator's override, the installation's choice, the
 * module's default), or null for a module without a setting level. Read from ROOT's map, which every key lookup loads anyway.
 */
export async function getSettingLevel(tenantId: string, moduleId: string): Promise<ResolvedSettingLevel | null> {
  if (!SETTING_LEVELS_BY_MODULE[moduleId]) return null;
  const { own, root } = await loadMaps(tenantId);
  const rootMap = root ?? own;
  return resolveSettingLevel(moduleId, tenantId, (k) => rootMap.get(k)?.value);
}

/** What a tenant's settings pages show for a module with a selectable level (phase 53.6). */
export interface SettingLevelView extends ResolvedSettingLevel {
  /** The keys and key families that follow the level: the fields a page hides at `platform`. */
  keys: readonly string[];
  prefixes: readonly string[];
  /** Whether the tenant set any key of the group: kept but unused at `platform`, in use at `tenant_first`. */
  ownGroup: boolean;
}

/**
 * Phase 53.6: the tenant's level of every module whose level the operator can choose, for its settings pages' notices. Fixed
 * modules are left out (always the tenant's own), and so is ROOT, which always reads its own rows. One map load for all of them.
 */
export async function getSettingLevelsView(tenantId: string): Promise<Record<string, SettingLevelView>> {
  if (isRootTenant(tenantId)) return {};
  const { own, root } = await loadMaps(tenantId);
  const rootMap = root ?? new Map<string, Setting>();
  const out: Record<string, SettingLevelView> = {};
  for (const [moduleId, declared] of Object.entries(SETTING_LEVELS_BY_MODULE)) {
    if (declared.allowed.length < 2) continue;
    out[moduleId] = {
      ...resolveSettingLevel(moduleId, tenantId, (k) => rootMap.get(k)?.value),
      keys: declared.keys,
      prefixes: declared.prefixes,
      ownGroup: tenantHasGroup(moduleId, own),
    };
  }
  return out;
}

export async function getValue(tenantId: string, key: string): Promise<string | null> {
  return (await getByKey(tenantId, key))?.value ?? null;
}

export async function getAllAsRecord(tenantId: string): Promise<Record<string, string>> {
  const settings = await getAll(tenantId);
  return Object.fromEntries(settings.map((s) => [s.key, s.value]));
}

export async function getByGroup(tenantId: string, group: string): Promise<Setting[]> {
  const settings = await withTenantRepositoryFor(tenantId, SettingEntity, (repo) => repo.find({ where: { tenantId, group } }));
  return parseRows(settings);
}
