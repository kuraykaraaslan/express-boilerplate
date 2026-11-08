import { ifActive } from '@kuraykaraaslan-labs/common/server/extensions/optional-module';

/**
 * Takes back a withdrawn announcement's bell entry that its reader has not read (plan A: withdraw removes the popup, the
 * banner and the unseen bell entries). The bell is `notification_inapp`'s, an optional module: where it is not active
 * there is nothing to take back.
 */
export async function recallInApp(tenantId: string, userId: string, ref: string): Promise<number> {
  const inapp = await ifActive(tenantId, 'notification_inapp', () => import('@kuraykaraaslan-labs/notification_inapp/server/notification_inapp.service'));
  if (!inapp) return 0;
  return inapp.default.recall(tenantId, userId, ref);
}
