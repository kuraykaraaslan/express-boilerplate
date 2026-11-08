import 'reflect-metadata';
import { getDataSource } from '@kuraykaraaslan-labs/db';
import redis, { jitter, singleFlight } from '@kuraykaraaslan-labs/redis';
import { env } from '@kuraykaraaslan-labs/env';
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import Logger from '@kuraykaraaslan-labs/logger';
import { UserPreferences as UserPreferencesEntity } from './entities/user_preferences.entity';
import {
  UserPreferences,
  UserPreferencesDefault,
  UserPreferencesSchema,
  PREFERENCES_SCHEMA_VERSION,
  TenantPreferenceDefaults,
} from './user_preferences.types';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import UserPreferencesMessages from './user_preferences.messages';
import { patchSchema } from '@kuraykaraaslan-labs/common/server/zod-patch';

const USER_PREFERENCES_CACHE_TTL = env.SESSION_CACHE_TTL ?? (60 * 5);

// Notification channels that can be disabled tenant-wide (a tenant without SMS
// infrastructure shouldn't expose live SMS toggles).
const CHANNEL_FIELDS: Record<string, keyof UserPreferences> = {
  email: 'emailNotifications',
  sms: 'smsNotifications',
  push: 'pushNotifications',
};

// Marketing-consent fields tracked for GDPR consent-evidence timestamps.
const MARKETING_FIELDS: (keyof UserPreferences)[] = ['productUpdates', 'promotionalOffers'];

// Every consent field of a new row starts off (06-user 1.3): opt-in, never a default.
const CONSENT_OFF: Pick<UserPreferences, 'newsletter' | 'productUpdates' | 'promotionalOffers'> = {
  newsletter: false,
  productUpdates: false,
  promotionalOffers: false,
};

export default class UserPreferencesService {

  private static async clearCache(userId: string): Promise<void> {
    await redis.del(`user_preferences:user:${userId}`).catch(() => {});
  }

  /**
   * Read a tenant's configured preference defaults from settings. A Japanese
   * tenant can default new users to `ja` / `Asia/Tokyo` / `JPY` instead of the
   * global `en` / `UTC` / `USD`, a US tenant to `MM_DD_YYYY` / `H12` / `SUN`.
   *
   * Language, timezone and currency come from the tenant's general settings; the
   * look and format defaults are this module's keys (user_preferences.setting.keys.ts,
   * page /admin/settings/member-preferences; the date, time and first-day keys were
   * added 2026-10-27). Unset = the global default.
   */
  static async getTenantDefaults(tenantId: string): Promise<TenantPreferenceDefaults> {
    try {
      const s = await SettingService.getByKeys(tenantId, [
        'defaultLanguage', 'defaultTimezone', 'defaultCurrency',
        'defaultTheme', 'defaultNumberFormat', 'defaultMeasurementSystem',
        'defaultDateFormat', 'defaultTimeFormat', 'defaultFirstDayOfWeek',
      ]);
      const out: Record<string, unknown> = {
        language: s.defaultLanguage || undefined,
        timezone: s.defaultTimezone || undefined,
        currency: s.defaultCurrency || undefined,
        theme: s.defaultTheme || undefined,
        numberFormat: s.defaultNumberFormat || undefined,
        measurementSystem: s.defaultMeasurementSystem || undefined,
        dateFormat: s.defaultDateFormat || undefined,
        timeFormat: s.defaultTimeFormat || undefined,
        firstDayOfWeek: s.defaultFirstDayOfWeek || undefined,
      };
      // Validate against the schema; drop any invalid configured default rather
      // than letting a bad setting poison a new user's row. An unset default is
      // left out, not kept as `undefined`: zod keeps the key, and getDefaults'
      // spread would then hide the global default under it.
      const parsed = patchSchema(UserPreferencesSchema).safeParse(
        Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)),
      );
      return parsed.success ? (parsed.data as TenantPreferenceDefaults) : {};
    } catch {
      return {};
    }
  }

  /**
   * Force-disable any notification channels the tenant has turned off platform-
   * wide (setting `disabledNotificationChannels`, e.g. `sms,push`). Returns a
   * shallow copy with restricted channels coerced to `false`.
   */
  static async applyChannelRestrictions(
    tenantId: string,
    data: Partial<UserPreferences>,
  ): Promise<Partial<UserPreferences>> {
    try {
      const s = await SettingService.getByKeys(tenantId, ['disabledNotificationChannels']);
      const disabled = (s.disabledNotificationChannels ?? '').split(',').map((c) => c.trim().toLowerCase()).filter(Boolean);
      if (disabled.length === 0) return data;
      const out = { ...data };
      for (const ch of disabled) {
        const field = CHANNEL_FIELDS[ch];
        if (field) (out as Record<string, unknown>)[field] = false;
      }
      return out;
    } catch {
      return data;
    }
  }

  /**
   * Stamp consent-evidence timestamps when a marketing-related field is GRANTED by this write: only on a false → true change against
   * `before` (06-user 1.3). Re-saving an already granted consent keeps the original time; a withdrawal never stamps. A new row has no
   * `before`, so a consent created true is stamped.
   */
  private static stampConsent(before: Partial<UserPreferences> | null, data: Partial<UserPreferences>): Partial<UserPreferences> {
    const now = new Date();
    const out = { ...data };
    const granted = (f: keyof UserPreferences) => data[f] === true && before?.[f] !== true;
    if (granted('newsletter')) out.newsletterConsentAt = now;
    if (MARKETING_FIELDS.some(granted)) out.marketingConsentAt = now;
    return out;
  }

  /**
   * The values a user without a preferences row has (06-user 1.3): global defaults ← the tenant's defaults ← consent off. Consent is
   * opt-in, so a marketing consent is never a default; it is only ever true because the person turned it on. The client shows these
   * instead of guessing its own.
   */
  static async getDefaults(tenantId?: string): Promise<UserPreferences> {
    const tenantDefaults = tenantId ? await this.getTenantDefaults(tenantId) : {};
    return { ...UserPreferencesDefault, ...tenantDefaults, ...CONSENT_OFF };
  }

  /**
   * What the preferences screen reads: the stored row, or the defaults when there is none (`persisted: false`), plus the defaults
   * themselves, so an empty account never renders as an editable form of client-side guesses.
   */
  static async getEffective(userId: string, tenantId?: string): Promise<{
    userPreferences: UserPreferences; defaults: UserPreferences; persisted: boolean;
  }> {
    const [stored, defaults] = await Promise.all([this.getByUserId(userId), this.getDefaults(tenantId)]);
    return { userPreferences: stored ?? defaults, defaults, persisted: stored !== null };
  }

  /** Migrate a stale row forward (fill new-field defaults, bump version). */
  private static async migrateIfStale(entity: UserPreferencesEntity): Promise<UserPreferences> {
    const parsed = UserPreferencesSchema.parse(entity);
    if ((entity.schemaVersion ?? 1) < PREFERENCES_SCHEMA_VERSION) {
      const ds = await getDataSource();
      const repo = ds.getRepository(UserPreferencesEntity);
      Object.assign(entity, parsed, { schemaVersion: PREFERENCES_SCHEMA_VERSION });
      await repo.save(entity).catch((e: unknown) =>
        Logger.warn(`[user_preferences] schema migrate failed: ${e instanceof Error ? e.message : e}`));
    }
    return parsed;
  }

  static async getByUserId(userId: string): Promise<UserPreferences | null> {
    const cacheKey = `user_preferences:user:${userId}`;
    const cached = await redis.get(cacheKey).catch(() => null);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        // Ignore cache entries written under an older schema version.
        if (parsed === null) return null;
        if (parsed?.schemaVersion === PREFERENCES_SCHEMA_VERSION) return UserPreferencesSchema.parse(parsed);
        await redis.del(cacheKey).catch(() => {});
      } catch { await redis.del(cacheKey).catch(() => {}); }
    }

    return singleFlight(cacheKey, async () => {
      const ds = await getDataSource();
      const prefs = await ds.getRepository(UserPreferencesEntity).findOne({ where: { userId } });
      const result = prefs ? await this.migrateIfStale(prefs) : null;
      await redis.setex(cacheKey, jitter(USER_PREFERENCES_CACHE_TTL), JSON.stringify(result)).catch(() => {});
      return result;
    });
  }

  /**
   * @param opts.defaultsTenantId whose defaults fill the fields `data` does not carry, when that is not `tenantId`; `null` = the global
   *        defaults only. Lets a save layer the same defaults the preferences GET showed (06-user 1.3).
   */
  static async create(
    userId: string,
    data?: Partial<UserPreferences>,
    tenantId?: string,
    opts?: { defaultsTenantId?: string | null },
  ): Promise<UserPreferences> {
    const ds = await getDataSource();
    const repo = ds.getRepository(UserPreferencesEntity);
    const existing = await repo.findOne({ where: { userId } });
    if (existing) throw new AppError(UserPreferencesMessages.PREFERENCES_ALREADY_EXIST, 409, ErrorCode.CONFLICT);

    // Layer: global defaults ← tenant defaults ← consent off ← explicit data; a consent the data grants is stamped (06-user 1.3).
    const defaultsTenant = opts?.defaultsTenantId === undefined ? tenantId : opts.defaultsTenantId ?? undefined;
    const merged = this.stampConsent(null, { ...(await this.getDefaults(defaultsTenant)), ...data });
    const prefs = repo.create({ userId, ...merged, schemaVersion: PREFERENCES_SCHEMA_VERSION });
    const saved = await repo.save(prefs);
    await this.clearCache(userId);
    const after = UserPreferencesSchema.parse(saved);
    // A consent granted on the first save is a decision like any other: it reaches the ledger, not only the timestamp (06-user 1.3).
    await this.recordMarketingConsent(userId, { ...after, ...CONSENT_OFF }, after, tenantId ?? null);
    return after;
  }

  static async update(
    userId: string,
    data: Partial<UserPreferences>,
    opts?: { tenantId?: string; actorId?: string },
  ): Promise<UserPreferences> {
    const ds = await getDataSource();
    const repo = ds.getRepository(UserPreferencesEntity);
    const prefs = await repo.findOne({ where: { userId } });
    if (!prefs) throw new AppError(UserPreferencesMessages.PREFERENCES_NOT_FOUND, 404, ErrorCode.NOT_FOUND);

    const before = UserPreferencesSchema.parse(prefs);
    let patch = data;
    if (opts?.tenantId) patch = await this.applyChannelRestrictions(opts.tenantId, patch);
    patch = this.stampConsent(before, patch);

    // patchSchema, not .partial(): zod 4 keeps defaults through .partial(),
    // which re-granted marketing consent and reset currency on every save.
    const validated = patchSchema(UserPreferencesSchema).parse(patch);
    Object.assign(prefs, validated, { schemaVersion: PREFERENCES_SCHEMA_VERSION });
    const saved = await repo.save(prefs);
    await this.clearCache(userId);

    const after = UserPreferencesSchema.parse(saved);
    await this.auditChange(userId, before, after, opts);
    await this.recordMarketingConsent(userId, before, after, opts?.tenantId ?? null);
    return after;
  }

  /**
   * Write a marketing consent DECISION to the consent ledger when one actually
   * changes (DUP-03).
   *
   * The boolean columns here remain the operational state — every send path
   * reads them and nothing about that changed. What they cannot do is answer
   * "when did they consent, and when did they take it back?", because a boolean
   * only remembers the latest value; `newsletterConsentAt` records a grant and
   * is simply left stale by a withdrawal. The ledger is append-only, so both
   * directions survive, which is what a GDPR Art. 7(1) demonstration requires.
   *
   * Only on TRANSITIONS: re-saving an unchanged preferences form must not
   * manufacture consent events, or the ledger fills with noise and the audit
   * trail becomes unreadable.
   */
  private static async recordMarketingConsent(
    userId: string,
    before: UserPreferences,
    after: UserPreferences,
    tenantId: string | null,
  ): Promise<void> {
    const decisions: { purpose: string; granted: boolean }[] = [];
    if (before.newsletter !== after.newsletter) {
      decisions.push({ purpose: 'marketing', granted: after.newsletter });
    }
    for (const field of MARKETING_FIELDS) {
      if (before[field] !== after[field]) decisions.push({ purpose: 'marketing', granted: !!after[field] });
    }
    if (decisions.length === 0) return;
    // One row per decision, not per field: several marketing toggles flipped in
    // one save are the same consent decision expressed several ways.
    const granted = decisions.some((d) => d.granted);
    const { recordConsent } = await import('@kuraykaraaslan-labs/auth/server/auth.consent-sink');
    await recordConsent({
      kind: 'PURPOSE',
      userId,
      purpose: 'marketing',
      granted,
      context: { tenantId, source: 'preferences' },
    });
  }

  /** Emit a change-history audit entry capturing only the changed fields. */
  private static async auditChange(
    userId: string,
    before: UserPreferences,
    after: UserPreferences,
    opts?: { tenantId?: string; actorId?: string },
  ): Promise<void> {
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of Object.keys(after) as (keyof UserPreferences)[]) {
      const a = before[key] instanceof Date ? (before[key] as Date)?.toISOString() : before[key];
      const b = after[key] instanceof Date ? (after[key] as Date)?.toISOString() : after[key];
      // channelPrefs is an object: compare by value, or every save would audit it as changed.
      const same = typeof a === 'object' && a !== null ? JSON.stringify(a) === JSON.stringify(b) : a === b;
      if (!same) changes[key] = { from: a, to: b };
    }
    if (Object.keys(changes).length === 0) return;
    await AuditLogService.log({
      tenantId: opts?.tenantId ?? null,
      actorId: opts?.actorId ?? userId,
      actorType: 'USER',
      action: 'user_preferences.updated',
      severity: 'low',
      resourceType: 'user_preferences',
      resourceId: userId,
      metadata: { changes },
    }).catch((e: unknown) => Logger.warn(`[user_preferences] audit failed: ${e instanceof Error ? e.message : e}`));
  }

  /** `opts.defaultsTenantId` only matters when no row exists yet; see create(). */
  static async upsert(
    userId: string,
    data: Partial<UserPreferences>,
    tenantId?: string,
    opts?: { defaultsTenantId?: string | null },
  ): Promise<UserPreferences> {
    const ds = await getDataSource();
    const repo = ds.getRepository(UserPreferencesEntity);
    const existing = await repo.findOne({ where: { userId } });

    if (existing) {
      return this.update(userId, data, { tenantId });
    }
    return this.create(userId, data, tenantId, opts);
  }

  static async delete(userId: string): Promise<void> {
    const ds = await getDataSource();
    const repo = ds.getRepository(UserPreferencesEntity);
    const prefs = await repo.findOne({ where: { userId } });
    if (!prefs) throw new AppError(UserPreferencesMessages.PREFERENCES_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    await repo.delete({ userId });
    await this.clearCache(userId);
  }

  static async getOrCreateDefault(userId: string, tenantId?: string): Promise<UserPreferences> {
    const ds = await getDataSource();
    const repo = ds.getRepository(UserPreferencesEntity);
    const existing = await repo.findOne({ where: { userId } });
    if (existing) return this.migrateIfStale(existing);
    return this.create(userId, undefined, tenantId);
  }
}
