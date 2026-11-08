import { z } from 'zod';

/**
 * Canonical per-tenant setting keys for the approval module. Centralised so the
 * runtime SLA resolver (approval.constants.ts / submit service) and the
 * settings-fields file (admin UI) never drift apart.
 *
 * The `approvalSlaHours*` keys override the hardcoded APPROVAL_SLA_HOURS bucket
 * map per priority (0=routine, 1=elevated, 2=high, 3=urgent). `slaDueAt` is NOT
 * part of the tamper-evident hash chain, so recomputing it from tenant config is
 * chain-safe. The optional `approvalBucketLabel*` keys let a tenant rename the
 * priority buckets shown in the UI.
 */
export const ApprovalSettingKeySchema = z.enum([
  'approvalSlaHoursRoutine',
  'approvalSlaHoursElevated',
  'approvalSlaHoursHigh',
  'approvalSlaHoursUrgent',
  'approvalBucketLabelRoutine',
  'approvalBucketLabelElevated',
  'approvalBucketLabelHigh',
  'approvalBucketLabelUrgent',
]);
export type ApprovalSettingKey = z.infer<typeof ApprovalSettingKeySchema>;
export const APPROVAL_KEYS = ApprovalSettingKeySchema.options;

/** Ordered SLA-hour keys indexed by numeric priority bucket (0..3). */
export const APPROVAL_SLA_HOUR_KEYS: readonly ApprovalSettingKey[] = [
  'approvalSlaHoursRoutine',
  'approvalSlaHoursElevated',
  'approvalSlaHoursHigh',
  'approvalSlaHoursUrgent',
] as const;
