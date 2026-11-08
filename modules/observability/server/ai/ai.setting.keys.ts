/** Per-tenant setting keys of the AI features (observability phase 20). One JSON document each, stored in the shared `settings` table. */
export const OBSERVABILITY_AI_SETTING_KEYS = {
  /** `AiSettings` (`ai.settings.ts`): the opt-in switches, the daily cap and the provider allow-list. Everything is OFF until a tenant admin turns it on. */
  SETTINGS: 'observabilityAiSettings',
} as const;
