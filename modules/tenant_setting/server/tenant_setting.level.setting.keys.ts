// Setting levels (docs/phases/53-setting-levels): the root tenant's rows that choose a module's level. Read from the root
// tenant's map only, never inherited, written only through the operator's route (53.3).
//   settingLevel.<moduleId>              the installation's level for the module
//   settingLevel.<moduleId>:<tenantId>   the operator's override for one tenant
// Template literals only in this file: the key catalog takes every quoted literal of a setting-keys file for a key.

export const SETTING_LEVEL_KEY_PREFIX = `settingLevel.`;

/** The root tenant's row holding the installation's level for `moduleId`. */
export const settingLevelKey = (moduleId: string): string => `settingLevel.${moduleId}`;

/** The root tenant's row holding the operator's level for `moduleId` in one tenant. */
export const settingLevelOverrideKey = (moduleId: string, tenantId: string): string => `settingLevel.${moduleId}:${tenantId}`;
