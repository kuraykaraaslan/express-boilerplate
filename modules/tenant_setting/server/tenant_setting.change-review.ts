import { ext, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext';
import { tenantSettingChangeReviewLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/tenant_setting.change_review';

/**
 * Who reviews a parked setting change when the tenant turned maker-checker on (`tenantSettingMakerChecker`).
 *
 * tenant_setting declares the point and the approval module answers it: approval requires tenant_setting (its SLA and
 * config live here), so tenant_setting must not import approval (docs/phases/37-extensions/10, 2026-10-17 second pass).
 * The decision comes back the other way: approval's own boot task registers the decision handler and calls
 * `applySettingChangeDecision` (tenant_setting.change-decision), an import approval may make.
 */
export const SETTING_CHANGE_REVIEW_POINT = 'tenant_setting:change_review';

/** One setting change parked for review. `value` is as `encryptValue` stores it: never plaintext for a secret key. */
export interface SettingChangeForReview {
  key: string;
  value: string;
  encrypted: boolean;
  /** Who proposed it; the approved write is attributed to them. */
  actorId: string | null;
}

/** What a `tenant_setting:change_review` contribution default-exports. */
export interface SettingChangeReviewer {
  /** Park one change for review and return the review item's id. Throws when it cannot be parked. */
  submit(tenantId: string, change: SettingChangeForReview): Promise<{ reviewId: string }>;
}

/**
 * The reviewer active for the tenant, or null when there is none (no approval module in the build, or it is off for
 * the tenant). A reviewer that is there but fails to load throws ProviderUnavailableError (409): maker-checker is a
 * security control, so the caller fails closed either way.
 */
export async function settingChangeReviewer(tenantId: string): Promise<SettingChangeReviewer | null> {
  const hit = await ext.select<SettingChangeReviewer>(SETTING_CHANGE_REVIEW_POINT, tenantCtx(tenantId), tenantSettingChangeReviewLoaders);
  return hit?.impl ?? null;
}
