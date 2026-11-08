import { z } from 'zod';

// The tenant's general keys, declared here so the catalog keeps them. Not auth's own keys: tenant_setting's General page
// edits them and no module owns them (tenant_setting.key-owners.ts, MS-44).

export const GeneralSettingKeySchema = z.enum([
  'siteName', 'siteUrl', 'siteDescription', 'logoUrl', 'faviconUrl',
  'applicationHost', 'applicationDomain', 'i18nLanguages',
  'contactName', 'contactTitle', 'contactEmail', 'contactPhone',
  'maintenanceMode', 'maintenanceMessage',
]);
export type GeneralSettingKey = z.infer<typeof GeneralSettingKeySchema>;
export const GENERAL_KEYS = GeneralSettingKeySchema.options;

