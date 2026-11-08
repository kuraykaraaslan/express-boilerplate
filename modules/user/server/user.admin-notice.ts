/**
 * 38-security 5.8: a platform admin was minted (created with, or granted, the platform-admin role): tell every OTHER active platform admin,
 * critically (a muted-mail preference cannot hide it). Best-effort; the audit row (severity critical) is the durable record.
 */
export async function notifyPlatformAdminGranted(granted: { userId: string; email: string }, actorId?: string | null): Promise<void> {
  try {
    const { getDataSource } = await import('@kuraykaraaslan-labs/db');
    const { User: UserEntity } = await import('./entities/user.entity');
    const admins = await (await getDataSource()).getRepository(UserEntity).find({ where: { userRole: 'ADMIN', userStatus: 'ACTIVE' } as never });
    const { default: NotificationService } = await import('@kuraykaraaslan-labs/notification/server/notification.service');
    const { ROOT_TENANT_ID } = await import('@kuraykaraaslan-labs/common/server/tenant-constants');
    const title = 'A new platform administrator was created';
    const body = `${granted.email} now holds the platform administrator role${actorId ? ` (granted by account ${actorId})` : ''}. If this was not expected, review it immediately.`;
    await Promise.all(admins
      .filter((a) => a.userId !== granted.userId && a.email)
      .map((a) => NotificationService.notifyCritical(
        ROOT_TENANT_ID,
        { userId: a.userId, email: a.email },
        { event: 'user.platform_admin_granted', category: 'security', title, body, data: { html: `<p>${body}</p>` } },
        { idempotencyKey: `platform_admin_granted:${granted.userId}:${a.userId}:${new Date().toISOString().slice(0, 13)}` },
      ).catch(() => undefined)));
  } catch { /* best-effort */ }
}
