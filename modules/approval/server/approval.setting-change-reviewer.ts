import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { SETTING_CHANGE_ENTITY_TYPE } from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.write.maker-checker';
import type { SettingChangeReviewer } from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.change-review';
import ApprovalQueueService from './approval.service';

/**
 * `tenant_setting:change_review` contribution: a setting change parked by maker-checker becomes an item of the shared
 * approval queue. The decision goes back through approval's `tenant_setting_change` handler
 * (approval.setting-change.ts), which tenant_setting cannot register itself: approval requires tenant_setting, so
 * tenant_setting does not import approval (docs/phases/37-extensions/10, 2026-10-17 second pass).
 */
const reviewer: SettingChangeReviewer = {
  async submit(tenantId, change) {
    const item = await ApprovalQueueService.submit(tenantId, {
      entityType: SETTING_CHANGE_ENTITY_TYPE,
      // The queue's entityId must be a UUID, so a synthetic id is minted and
      // the real target key is carried in metadata (read back on decision).
      entityId: randomUUID(),
      submittedByUserId: change.actorId,
      priority: 0,
      reason: `Setting "${change.key}" change pending review`,
      metadata: { key: change.key, value: change.value, encrypted: change.encrypted, actorId: change.actorId },
    });
    return { reviewId: item.approvalItemId };
  },
};

export default reviewer;
