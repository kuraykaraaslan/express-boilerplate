import type { SettingFieldDef } from '@kuraykaraaslan-labs/tenant_setting/server/setting-fields.types';

// UI metadata for the Webhooks settings page. Keys cover the per-delivery
// knobs and the reliability controls. The global worker-pool knob
// (webhookWorkerConcurrency) is intentionally excluded — it is a shared
// resource, not a per-tenant setting. webhook.config.ts reads these per tenant
// (`resolveDeliveryConfig`) with the documented defaults as fallback. Saves are
// validated (tenant_setting.validation.ts WEBHOOK_INTEGER_SETTINGS and the
// delay-list rule, 41-ui-fixes/12 4.1); the descriptions state the ranges.
export const WEBHOOK_SETTINGS_FIELDS: SettingFieldDef[] = [
  {
    key: 'webhookMaxAttempts',
    label: 'Max Delivery Attempts',
    description: 'How many attempts a delivery gets, the first one included, before it is dead-lettered. 1 to 10.',
    group: 'Delivery & Retries',
    type: 'number',
    defaultValue: '3',
    placeholder: '3',
  },
  {
    key: 'webhookRetryDelaysMs',
    label: 'Retry Backoff (ms)',
    description: 'The wait before retry 1, 2, 3… in milliseconds, comma-separated (up to 9 values, each 1000 to 86400000). A retry past the list waits the last value. Default: 60000,300000,900000',
    group: 'Delivery & Retries',
    type: 'text',
    defaultValue: '60000,300000,900000',
    placeholder: '60000,300000,900000',
  },
  {
    key: 'webhookRequestTimeoutMs',
    label: 'Request Timeout (ms)',
    description: 'Per-request timeout for a webhook delivery, in milliseconds. 1000 to 120000.',
    group: 'Delivery & Retries',
    type: 'number',
    defaultValue: '15000',
    placeholder: '15000',
  },
  {
    key: 'webhookCircuitBreakerThreshold',
    label: 'Circuit Breaker Threshold',
    description: 'Auto-disable an endpoint after this many consecutive failed deliveries (1 to 100000). A success resets the counter; test sends do not count.',
    group: 'Reliability',
    type: 'number',
    defaultValue: '10',
    placeholder: '10',
  },
  {
    key: 'webhookDefaultRateLimitPerMinute',
    label: 'Default Rate Limit (per minute)',
    description: 'Fallback per-endpoint delivery rate limit when a webhook has none set. Leave blank or enter 0 for unlimited.',
    group: 'Reliability',
    type: 'number',
    placeholder: '600',
  },
];
