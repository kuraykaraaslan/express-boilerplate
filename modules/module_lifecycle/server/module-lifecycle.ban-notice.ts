import { IsNull } from 'typeorm';
import Logger from '@kuraykaraaslan-labs/logger';
import { withSystemRLS, withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { moduleRegistry } from '@kuraykaraaslan-labs/common/server/module-registry';
import { ifActive } from '@kuraykaraaslan-labs/common/server/extensions/optional-module';
import { TenantMember } from '@kuraykaraaslan-labs/tenant_member/server/entities/tenant_member.entity';
import { Install } from './entities/install.entity';

/**
 * The one notice a tenant gets when the platform bans a built-in module it uses, or lifts that ban
 * (docs/phases/37-extensions/07). The module goes dark everywhere at once; without this, a workspace's admins would see
 * pages and menu items vanish with no reason given. Sent to the active admins of every tenant whose install ledger has
 * the module active, once per ban (the idempotency key carries the ban's time), and only where notifications are on
 * (`notification` is optional for module_lifecycle, EXT-14). Best-effort: a tenant that cannot be told is logged and
 * skipped, and the ban itself never waits for this.
 */

export type BanChange = { kind: 'banned' | 'lifted'; reason: string; at: string };

/** Tenants with an active, not uninstalled install of the module. */
export async function tenantsUsing(moduleId: string): Promise<string[]> {
  const rows = await withSystemRLS((qr) => qr.manager.getRepository(Install).find({
    where: { artifactType: 'module', artifactId: moduleId, active: true, uninstalledAt: IsNull() },
    select: { tenantId: true },
  }));
  return [...new Set(rows.map((r) => r.tenantId))];
}

function message(moduleId: string, change: BanChange): { title: string; body: string } {
  const name = moduleRegistry.getModule(moduleId)?.name ?? moduleId;
  return change.kind === 'banned'
    ? {
        title: `${name} is switched off by the platform`,
        body: `The platform operator switched ${name} off for every workspace: ${change.reason}. Its pages and features are unavailable until the ban is lifted; your data in it is kept.`,
      }
    : {
        title: `${name} is available again`,
        body: `The platform operator lifted the ban on ${name}. It is back as it was in this workspace.`,
      };
}

export async function noticeBanChange(moduleId: string, change: BanChange): Promise<{ notified: number; skipped: number }> {
  const { title, body } = message(moduleId, change);
  let notified = 0;
  let skipped = 0;
  for (const tenantId of await tenantsUsing(moduleId)) {
    try {
      const notifications = await ifActive(tenantId, 'notification', () => import('@kuraykaraaslan-labs/notification/server/notification.service'));
      const admins = notifications
        ? await withTenantRepositoryFor(tenantId, TenantMember, (repo) => repo.find({
            where: { tenantId, memberRole: 'ADMIN', memberStatus: 'ACTIVE' },
            select: { userId: true },
          }))
        : [];
      if (!notifications || admins.length === 0) { skipped += 1; continue; }
      await notifications.default.notify(
        tenantId,
        admins.map((a) => ({ userId: a.userId })),
        { event: `module_lifecycle.module.${change.kind === 'banned' ? 'banned' : 'ban_lifted'}`, category: 'workspace', title, body },
        { urgency: 'NORMAL', idempotencyKey: `module.ban:${moduleId}:${change.kind}:${change.at}` },
      );
      notified += 1;
    } catch (error) {
      skipped += 1;
      Logger.warn(`[module_lifecycle] could not tell ${tenantId} that ${moduleId} was ${change.kind}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { notified, skipped };
}
