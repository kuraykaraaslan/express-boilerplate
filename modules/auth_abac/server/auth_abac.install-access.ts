import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { installAccess } from '@kuraykaraaslan-labs/common/server/install-config/install-config.access';
import { describeInstallAccess } from '@kuraykaraaslan-labs/common/server/install-config/install-config.service';
import Logger from '@kuraykaraaslan-labs/logger';

/**
 * The boot listing of the installation's config/access.ts (docs/phases/45-install-config D45-4): every removal and
 * grant once in the log, and the grants once in the platform's audit log, so a permission handed out by a file is
 * never invisible. Called by instrumentation.ts when the server starts. Throws InstallConfigError on an invalid file
 * (the boot fails loudly); a failed audit write is logged, never fatal.
 */
export function announceInstallAccess(): { grants: string[]; removals: string[] } {
  const listed = describeInstallAccess(installAccess());
  const { grants, removals } = listed;
  if (removals.length) Logger.info(`[install-config] config/access.ts removes ${removals.length}: ${removals.join(', ')}`);
  if (!grants.length) return listed;
  Logger.info(`[install-config] config/access.ts grants ${grants.length}: ${grants.join(', ')}`);
  void AuditLogService.log({
    tenantId: ROOT_TENANT_ID,
    actorType: 'SYSTEM',
    actorId: null,
    action: 'install_config.access.grants',
    resourceType: 'install_config',
    resourceId: 'config/access.ts',
    metadata: { grants, removals },
  }).catch((e: unknown) => Logger.warn(`[install-config] the grants were not written to the audit log: ${e instanceof Error ? e.message : String(e)}`));
  return listed;
}
