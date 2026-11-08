import 'reflect-metadata';
import type { FindOptionsWhere } from 'typeorm';
import type { SeedContext } from '@kuraykaraaslan-labs/db/server/db.seed-contracts';
import { SEED_ADMIN_USER_ID, SEED_USER_ID } from '@kuraykaraaslan-labs/db/server/db.seed-contracts';
import { Setting } from './entities/setting.entity';
import { SettingHistory } from './entities/setting_history.entity';

/**
 * Demo-data seed for the `setting` module.
 *
 * The `Setting` entity is a tenant-scoped key/value store with a composite
 * primary key `(tenantId, key)`, so:
 *  - it carries a `tenantId` column → use `ctx.repo<Setting>(Setting)` and set
 *    `tenantId: ctx.tenantId`;
 *  - the natural key for idempotent `foc` is the `(tenantId, key)` pair.
 *
 * `value` is always stored as `text` — non-string values are serialised to a
 * string and the `type` column ('string' | 'number' | 'boolean' | 'json' | …)
 * tells the reader how to coerce it back. `group` buckets keys for the admin
 * UI (General · Auth · Email · SMS · Storage · AI · Security · Payment ·
 * Subscription · Integrations · Analytics · SEO · Social · Localization).
 *
 * Every key string below is taken from a module's `*.setting.keys.ts` enum so
 * the values round-trip through `SettingService` exactly as the app expects.
 *
 * It also seeds `setting_history`, the audit trail `SettingService` appends to on every
 * change. Each chain below is the made-up past of a setting this seed already writes and
 * ENDS AT THAT SETTING'S CURRENT VALUE, so history and `settings` tell the same story and
 * this seed never changes a current value (it never writes a `Setting` through the history
 * path). Only non-secret keys get history. Demo-safe, so it runs in every lane.
 */
export async function seedSetting(ctx: SeedContext): Promise<void> {
  const { tenantId, foc } = ctx;
  const repo = ctx.repo<Setting>(Setting);

  // Concrete local type (do NOT use Partial<Setting>) so foc's create inference
  // stays intact under tsc.
  type SettingDef = { key: string; value: string; group: string; type: string };

  // ── Varied rows exercising different groups, types and value shapes ─────────
  const defs: SettingDef[] = [
    // General — site identity (string + boolean + maintenance toggle)
    { key: 'siteName', value: 'Acme Demo', group: 'General', type: 'string' },
    { key: 'siteUrl', value: 'https://demo.acme.test', group: 'General', type: 'string' },
    { key: 'maintenanceMode', value: 'false', group: 'General', type: 'boolean' },
    { key: 'contactEmail', value: 'hello@demo.acme.test', group: 'General', type: 'string' },

    // Auth — password policy
    { key: 'passwordMinLength', value: '12', group: 'Auth', type: 'number' },

    // Email — provider routing + numeric SMTP port
    { key: 'mailProvider', value: 'smtp', group: 'Email', type: 'string' },
    { key: 'fromEmail', value: 'noreply@demo.acme.test', group: 'Email', type: 'string' },
    { key: 'fromName', value: 'Acme Demo', group: 'Email', type: 'string' },
    { key: 'smtpPort', value: '587', group: 'Email', type: 'number' },

    // Storage — provider + numeric size limit + json allowlist
    { key: 'storageProvider', value: 's3', group: 'Storage', type: 'string' },
    { key: 'maxFileSizeMb', value: '25', group: 'Storage', type: 'number' },
    { key: 'allowedExtensions', value: JSON.stringify(['png', 'jpg', 'pdf']), group: 'Storage', type: 'json' },
    // Storage — MIME allowlist by group (comma-separated group keys: images,
    // documents, spreadsheets, presentations, archives, audio, video, data) plus
    // optional explicit MIME types; both empty = allow all.
    { key: 'allowedMimeGroups', value: 'images,documents', group: 'Storage', type: 'string' },
    { key: 'allowedMimeTypes', value: '', group: 'Storage', type: 'string' },
    // Storage — virus scanning (off by default; needs an API key to activate)
    { key: 'virusScanEnabled', value: 'false', group: 'Storage', type: 'boolean' },
    { key: 'virusScanMode', value: 'async', group: 'Storage', type: 'string' },
    { key: 'virusScanProvider', value: 'virustotal', group: 'Storage', type: 'string' },
    { key: 'virusScanApiKey', value: '', group: 'Storage', type: 'string' },
    { key: 'virusScanTimeoutSeconds', value: '30', group: 'Storage', type: 'number' },
    { key: 'virusScanInfectedAction', value: 'quarantine', group: 'Storage', type: 'string' },
    { key: 'virusScanQuarantineFolder', value: 'quarantine', group: 'Storage', type: 'string' },

    // Localization — formats + week start + currency placement
    { key: 'defaultTimezone', value: 'Europe/Istanbul', group: 'Localization', type: 'string' },
    { key: 'defaultLanguage', value: 'en', group: 'Localization', type: 'string' },
    // ISO-3166 alpha-2. Also the phone-number parsing region every domain reads
    // through `resolveTenantCountry` — see tenant_setting.country.ts.
    { key: 'defaultCountry', value: 'TR', group: 'Localization', type: 'string' },
    // Every locale the admin UI is OFFERED in. Only `en`/`tr` are translated so
    // far — the rest render in English via the per-key fallback in
    // pickLocaleMessages(). Every language listed here is offered in the admin
    // language switcher, translated or not.
    { key: 'enabledLanguages', value: 'en,tr,zh,ru,de', group: 'Localization', type: 'string' },
    { key: 'dateFormat', value: 'DD.MM.YYYY', group: 'Localization', type: 'string' },
    { key: 'weekStartsOn', value: '1', group: 'Localization', type: 'number' },
    { key: 'currencyPosition', value: 'suffix', group: 'Localization', type: 'string' },

    // SEO — robots + sitemap (seo's keys; MS-16: the dead twitterCardType is no longer seeded)
    { key: 'metaRobots', value: 'index,follow', group: 'SEO', type: 'string' },
    { key: 'sitemapEnabled', value: 'true', group: 'SEO', type: 'boolean' },

    // Social — profile urls
    { key: 'twitterUrl', value: 'https://twitter.com/acmedemo', group: 'Social', type: 'string' },
    { key: 'githubProfileUrl', value: 'https://github.com/acmedemo', group: 'Social', type: 'string' },

    // Analytics — tracking id
    { key: 'googleTagId', value: 'G-DEMO12345', group: 'Analytics', type: 'string' },
  ];

  let count = 0;
  for (const def of defs) {
    await foc(
      repo,
      { tenantId, key: def.key } as FindOptionsWhere<Setting>,
      { tenantId, key: def.key, value: def.value, group: def.group, type: def.type },
    );
    count++;
  }

  // ── Change history ──────────────────────────────────────────────────────────
  // Oldest value first; the last element must be the key's current seeded value (checked below).
  const HISTORY_ANCHOR = Date.UTC(2026, 5, 1, 9, 0, 0);
  const DAY = 24 * 60 * 60 * 1000;
  type Step = { value: string; daysBeforeAnchor: number; by: string | null };
  const chains: Record<string, Step[]> = {
    siteName: [
      { value: 'My Site', daysBeforeAnchor: 200, by: SEED_ADMIN_USER_ID },
      { value: 'Acme', daysBeforeAnchor: 120, by: SEED_ADMIN_USER_ID },
      { value: 'Acme Demo', daysBeforeAnchor: 60, by: SEED_USER_ID },
    ],
    maintenanceMode: [
      { value: 'false', daysBeforeAnchor: 90, by: SEED_ADMIN_USER_ID },
      { value: 'true', daysBeforeAnchor: 45, by: SEED_ADMIN_USER_ID },
      { value: 'false', daysBeforeAnchor: 45, by: SEED_ADMIN_USER_ID },
    ],
    passwordMinLength: [
      { value: '8', daysBeforeAnchor: 300, by: null },
      { value: '10', daysBeforeAnchor: 150, by: SEED_ADMIN_USER_ID },
      { value: '12', daysBeforeAnchor: 30, by: SEED_ADMIN_USER_ID },
    ],
    smtpPort: [
      { value: '25', daysBeforeAnchor: 250, by: SEED_ADMIN_USER_ID },
      { value: '587', daysBeforeAnchor: 249, by: SEED_ADMIN_USER_ID },
    ],
    maxFileSizeMb: [
      { value: '10', daysBeforeAnchor: 180, by: SEED_ADMIN_USER_ID },
      { value: '25', daysBeforeAnchor: 20, by: SEED_ADMIN_USER_ID },
    ],
    allowedExtensions: [
      { value: JSON.stringify(['png', 'jpg']), daysBeforeAnchor: 180, by: SEED_ADMIN_USER_ID },
      { value: JSON.stringify(['png', 'jpg', 'pdf']), daysBeforeAnchor: 100, by: SEED_ADMIN_USER_ID },
    ],
    defaultTimezone: [
      { value: 'UTC', daysBeforeAnchor: 365, by: null },
      { value: 'Europe/Istanbul', daysBeforeAnchor: 364, by: SEED_ADMIN_USER_ID },
    ],
    dateFormat: [
      { value: 'MM/DD/YYYY', daysBeforeAnchor: 365, by: null },
      { value: 'DD.MM.YYYY', daysBeforeAnchor: 200, by: SEED_ADMIN_USER_ID },
    ],
    contactEmail: [
      { value: 'info@demo.acme.test', daysBeforeAnchor: 140, by: SEED_ADMIN_USER_ID },
      { value: 'hello@demo.acme.test', daysBeforeAnchor: 70, by: SEED_ADMIN_USER_ID },
    ],
  };
  const historyRepo = ctx.repo<SettingHistory>(SettingHistory);
  let historyCount = 0;
  for (const [key, steps] of Object.entries(chains)) {
    const current = defs.find((d) => d.key === key);
    if (!current || current.value !== steps[steps.length - 1].value) {
      throw new Error(`setting seed: history for "${key}" must end at the seeded current value`);
    }
    for (let i = 0; i < steps.length; i++) {
      const previousValue = i === 0 ? '' : steps[i - 1].value;
      const newValue = steps[i].value;
      const createdAt = new Date(HISTORY_ANCHOR - steps[i].daysBeforeAnchor * DAY);
      await foc(
        historyRepo,
        { tenantId, key, previousValue, newValue, createdAt } as FindOptionsWhere<SettingHistory>,
        { tenantId, key, previousValue, newValue, createdAt, changedByUserId: steps[i].by ?? undefined },
      );
      historyCount++;
    }
  }

  ctx.log(`setting: ${count} key/value settings across ${new Set(defs.map((d) => d.group)).size} groups and ${historyCount} history rows for ${tenantId}`);
}
