import type { SettingFieldDef, SettingFieldOption } from './setting-fields.types';
import { LANGUAGE_OPTIONS } from '@kuraykaraaslan-labs/localization/server/languages';
import { DIAL_OPTIONS } from '@kuraykaraaslan-labs/localization/server/countries';

/**
 * Mirrors `DEFAULT_COUNTRY` in `./tenant_setting.country`, as a literal rather
 * than an import — ON PURPOSE.
 *
 * This file is a field DESCRIPTION, and `ui/settings-localization.page.tsx` is
 * a `'use client'` component that imports it. `tenant_setting.country` imports
 * `SettingService`, which reaches the whole TypeORM/db stack, so an import here
 * would drag `async_hooks` and friends into a client bundle and fail the build.
 * Two occurrences of `'TR'` is the cheaper problem, and the pair is pinned by
 * `tests/tenant_setting.country.test.ts`.
 */
const DEFAULT_COUNTRY = 'TR';

// Flag-decorated options for the language pickers (full ISO 639-1 catalogue).
const OPTIONS: SettingFieldOption[] = LANGUAGE_OPTIONS.map((o) => ({ value: o.value, label: o.label, flag: o.flag }));

// Countries that have an E.164 dialing plan, labelled with their dial code
// (`Türkiye (+90)`). Restricted to dialable territories on purpose: this value
// is also the phone parsing region, and offering a country with no plan would
// let a tenant pick a hint that cannot parse anything.
const COUNTRY_OPTIONS: SettingFieldOption[] = DIAL_OPTIONS.map((o) => ({ value: o.value, label: o.label, flag: o.flag }));

/**
 * The CENTRAL Localization settings — the canonical home of the tenant's
 * application languages (`defaultLanguage` + `enabledLanguages`, group
 * `Localization`). These drive the admin-UI language every user can choose AND
 * (clamped to the content plan by dynamic_page) the publishable site languages.
 */
export const LOCALIZATION_SETTINGS_FIELDS: SettingFieldDef[] = [
  {
    key: 'defaultLanguage',
    label: 'Default language',
    description: 'The application’s primary language. New users start in this language until they pick their own.',
    group: 'Languages',
    type: 'flag-select',
    options: OPTIONS,
    defaultValue: 'en',
  },
  {
    key: 'enabledLanguages',
    label: 'Available languages',
    description: 'Languages users may switch the application to (the default is always included). Each user’s choice is remembered on their profile.',
    group: 'Languages',
    type: 'flag-multiselect',
    options: OPTIONS,
    defaultValue: 'en',
  },
  {
    key: 'defaultCountry',
    label: 'Default country',
    description:
      'Where this workspace operates. Decides how phone numbers typed in national form (0532 123 45 67) are stored (+90 532 123 45 67), which public holidays are seeded, and which national-id validator runs.',
    group: 'Region',
    type: 'flag-select',
    options: COUNTRY_OPTIONS,
    defaultValue: DEFAULT_COUNTRY,
  },
];
