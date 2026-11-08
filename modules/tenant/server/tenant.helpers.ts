import 'reflect-metadata';
import { assignDefaultPlan, applyDefaultModules, runSeedSteps, type TenantSeedHints } from './tenant.extension-points';
import redis from '@kuraykaraaslan-labs/redis';
import { env } from '@kuraykaraaslan-labs/env';
import Logger from '@kuraykaraaslan-labs/logger';
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';

export const TENANT_CACHE_TTL = env.TENANT_CACHE_TTL ?? (60 * 5);

// ── Default locale per region ─────────────────────────────────────────────────
export const REGION_LOCALE_DEFAULTS: Record<string, { language: string; timezone: string; dateFormat: string; timeFormat: string }> = {
  TR:    { language: 'tr',    timezone: 'Europe/Istanbul',       dateFormat: 'DD.MM.YYYY', timeFormat: 'HH:mm' },
  EU:    { language: 'en',    timezone: 'Europe/Berlin',         dateFormat: 'DD.MM.YYYY', timeFormat: 'HH:mm' },
  US:    { language: 'en',    timezone: 'America/New_York',      dateFormat: 'MM/DD/YYYY', timeFormat: 'hh:mm A' },
  APAC:  { language: 'en',    timezone: 'Asia/Singapore',        dateFormat: 'DD/MM/YYYY', timeFormat: 'HH:mm' },
  LATAM: { language: 'es',    timezone: 'America/Sao_Paulo',     dateFormat: 'DD/MM/YYYY', timeFormat: 'HH:mm' },
  MEA:   { language: 'en',    timezone: 'Asia/Dubai',            dateFormat: 'DD/MM/YYYY', timeFormat: 'HH:mm' },
};

const SEED_LANGUAGE_RE = /^[a-z]{2,3}(-[A-Z]{2})?$/;

export type SeedDefaults = {
  skipPlan?: boolean;
  skipSubscription?: boolean;
  skipSettings?: boolean;
  /** Skip the platform's default modules (`tenant:default_modules`). */
  skipModules?: boolean;
};

export async function clearCache(tenantId: string): Promise<void> {
  // The profile and the fleet routing row (`tenant.fleet-route.ts`, key spelled out here to keep the helpers free of that module).
  await redis.del(`tenant:id:${tenantId}`, `tenant:route:${tenantId}`).catch(() => {});
}

export async function seedDefaults(
  tenantId: string,
  defaults?: SeedDefaults,
  region?: string,
  hints?: TenantSeedHints,
): Promise<{ ok: boolean; errors: string[] }> {
  if (isRootTenant(tenantId)) return { ok: true, errors: [] };

  const errors: string[] = [];

  if (!defaults?.skipPlan && !defaults?.skipSubscription) {
    try {
      await assignDefaultPlan(tenantId); // contributed by the module that sells plans (`tenant:default_plan`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Logger.warn(`[TenantService.seedDefaults] default plan assignment failed for ${tenantId}: ${msg}`);
      errors.push(`plan: ${msg}`);
    }
  }

  // After the plan, so the module installer's plan check sees the new tenant's plan. A module
  // the plan does not cover is reported, never forced; nothing here fails the creation.
  if (!defaults?.skipModules) {
    try {
      const { skipped } = await applyDefaultModules(tenantId); // contributed by module_lifecycle (`tenant:default_modules`)
      for (const s of skipped) errors.push(`modules: ${s.moduleId}: ${s.error}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Logger.warn(`[TenantService.seedDefaults] default modules failed for ${tenantId}: ${msg}`);
      errors.push(`modules: ${msg}`);
    }
  }

  if (!defaults?.skipSettings) {
    try {
      const SettingService = (await import('@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service')).default;
      // Use region-aware locale defaults
      const localeDefaults = (region ? REGION_LOCALE_DEFAULTS[region] : null) ?? REGION_LOCALE_DEFAULTS['TR'];
      // A fleet zone's language (seed hint, phase 6c) wins over the region's: an EU zone sign-up starts in the zone's language.
      const language = hints?.language && SEED_LANGUAGE_RE.test(hints.language) ? hints.language : localeDefaults.language;
      await SettingService.updateMany(tenantId, {
        language,
        dateFormat: localeDefaults.dateFormat,
        timeFormat: localeDefaults.timeFormat,
        timezone: localeDefaults.timezone,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Logger.warn(`[TenantService.seedDefaults] default settings seed failed for ${tenantId}: ${msg}`);
      errors.push(`settings: ${msg}`);
    }
  }

  // Last, as the wildcard subdomain always was: steps other modules own (tenant_domain mints `<slug>.<wildcard>`), run
  // one after another through `tenant:seed_step`. A failure is reported, never thrown.
  try {
    errors.push(...await runSeedSteps(tenantId, hints));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    Logger.warn(`[TenantService.seedDefaults] seed steps failed for ${tenantId}: ${msg}`);
    errors.push(`seed steps: ${msg}`);
  }

  return { ok: errors.length === 0, errors };
}
