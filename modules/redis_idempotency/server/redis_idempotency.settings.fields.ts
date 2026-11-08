import type { SettingFieldDef } from '@kuraykaraaslan-labs/tenant_setting/server/setting-fields.types';

// UI metadata for the idempotency settings page (/admin/platform/idempotency/settings, ROOT tenant only). The store reads the values
// from the ROOT tenant, cached for a minute (redis_idempotency.settings-policy.ts); each one can only lengthen a built-in time.
export const REDIS_IDEMPOTENCY_SETTINGS_FIELDS: SettingFieldDef[] = [
  {
    key: 'idempotencyReplayHours',
    label: 'Remember a finished request (hours)',
    description: 'How long a request sent with an Idempotency-Key is remembered once it succeeded: a retry with the same key gets the first answer instead of running again. 24 (the built-in time) to 168 hours; longer suits apps that send queued changes after days offline.',
    group: 'Retried requests',
    type: 'number',
    defaultValue: '24',
    placeholder: '24',
    rootOnly: true,
  },
  {
    key: 'idempotencyPendingMinutes',
    label: 'Hold a running request (minutes)',
    description: 'How long a request still running holds its Idempotency-Key, so a retry is refused instead of running twice: 10 (the built-in time) to 60 minutes. A request whose server stopped also holds its key this long.',
    group: 'Retried requests',
    type: 'number',
    defaultValue: '10',
    placeholder: '10',
    rootOnly: true,
  },
];
