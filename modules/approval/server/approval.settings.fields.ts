import type { SettingFieldDef } from '@kuraykaraaslan-labs/tenant_setting/server/setting-fields.types';

// UI metadata for the Approval settings page. One entry per per-tenant setting
// key. SLA-hour values override the hardcoded APPROVAL_SLA_HOURS bucket map and
// only affect the (unhashed) slaDueAt computation — chain-safe.
export const APPROVAL_SETTINGS_FIELDS: SettingFieldDef[] = [
  {
    key: 'approvalSlaHoursRoutine',
    label: 'Routine SLA (hours)',
    description: 'Hours-to-first-resolution for priority 0 (routine) items.',
    group: 'SLA',
    type: 'number',
    defaultValue: '72',
    placeholder: '72',
  },
  {
    key: 'approvalSlaHoursElevated',
    label: 'Elevated SLA (hours)',
    description: 'Hours-to-first-resolution for priority 1 (elevated) items.',
    group: 'SLA',
    type: 'number',
    defaultValue: '48',
    placeholder: '48',
  },
  {
    key: 'approvalSlaHoursHigh',
    label: 'High SLA (hours)',
    description: 'Hours-to-first-resolution for priority 2 (high) items.',
    group: 'SLA',
    type: 'number',
    defaultValue: '24',
    placeholder: '24',
  },
  {
    key: 'approvalSlaHoursUrgent',
    label: 'Urgent SLA (hours)',
    description: 'Hours-to-first-resolution for priority 3 (urgent) items.',
    group: 'SLA',
    type: 'number',
    defaultValue: '8',
    placeholder: '8',
  },
  {
    key: 'approvalBucketLabelRoutine',
    label: 'Routine bucket label',
    description: 'Display label for the priority 0 bucket.',
    group: 'Priority labels',
    type: 'text',
    defaultValue: 'Routine',
    placeholder: 'Routine',
  },
  {
    key: 'approvalBucketLabelElevated',
    label: 'Elevated bucket label',
    description: 'Display label for the priority 1 bucket.',
    group: 'Priority labels',
    type: 'text',
    defaultValue: 'Elevated',
    placeholder: 'Elevated',
  },
  {
    key: 'approvalBucketLabelHigh',
    label: 'High bucket label',
    description: 'Display label for the priority 2 bucket.',
    group: 'Priority labels',
    type: 'text',
    defaultValue: 'High',
    placeholder: 'High',
  },
  {
    key: 'approvalBucketLabelUrgent',
    label: 'Urgent bucket label',
    description: 'Display label for the priority 3 bucket.',
    group: 'Priority labels',
    type: 'text',
    defaultValue: 'Urgent',
    placeholder: 'Urgent',
  },
];
