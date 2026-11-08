import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import { APPROVAL_KEYS } from './approval.setting.keys';

/**
 * The `approvalBucketLabel*` settings, which nothing read until 2026-09-25.
 * The UI showed a bare number in the queue and a hard-coded English name on
 * the detail page. The list and detail responses now carry
 * `priorityLabels`, the tenant's saved label per bucket (0..3) or the
 * built-in name when unset or blank. A priority outside 0..3 has no bucket,
 * and the UI labels it "Custom".
 */

export const DEFAULT_PRIORITY_LABELS: Readonly<Record<number, string>> = { 0: 'Routine', 1: 'Elevated', 2: 'High', 3: 'Urgent' };

const LABEL_KEYS = ['approvalBucketLabelRoutine', 'approvalBucketLabelElevated', 'approvalBucketLabelHigh', 'approvalBucketLabelUrgent'] as const;
// Pinned against the key enum so a rename there fails here.
LABEL_KEYS.forEach((k) => { if (!APPROVAL_KEYS.includes(k)) throw new Error(`unknown approval setting ${k}`); });

export async function getPriorityLabels(tenantId: string): Promise<Record<number, string>> {
  const s = await SettingService.getByKeys(tenantId, [...LABEL_KEYS]).catch(() => ({} as Record<string, string | null>));
  const out: Record<number, string> = {};
  LABEL_KEYS.forEach((key, bucket) => {
    const v = (s[key] ?? '').trim();
    out[bucket] = v ? v.slice(0, 64) : DEFAULT_PRIORITY_LABELS[bucket]!;
  });
  return out;
}
