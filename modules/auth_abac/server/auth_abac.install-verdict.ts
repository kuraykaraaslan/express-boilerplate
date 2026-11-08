import { installAccessVerdict, type InstallAccessVerdict } from '@kuraykaraaslan-labs/common/server/install-config/install-config.access';
import { installRoleLabels } from '@kuraykaraaslan-labs/common/server/install-config/install-config.roles';
import { isGlobalAdminMember } from '@kuraykaraaslan-labs/tenant_session/server/tenant_session.global-admin';
import type { SubjectSource } from './auth_abac.attributes';

/**
 * What the installation's config/access.ts says about this caller (docs/phases/45-install-config D45-4), by their
 * install roles: the built-in role (`sysadmin` for the platform's operator) and their custom groups. One place for the
 * PDP adapter (the decision), the bulk resolver and the role floor (the lift), so the three read one verdict. A platform
 * admin is `sysadmin` by the session's flag or by the virtual member they act through, so a caller that builds its own
 * session without the flag cannot make them the tenant's `owner`. Throws on an invalid config/access.ts: nothing is
 * decided without it.
 */
export function installVerdictOf(tenantId: string, session: SubjectSource): InstallAccessVerdict {
  return installAccessVerdict(installRoleLabels({
    tenantId,
    memberRole: session.tenantMember?.memberRole,
    roleKeys: session.tenantMember?.roleKeys,
    isGlobalAdmin: session.isGlobalAdmin === true || isGlobalAdminMember(session.tenantMember),
    userRole: session.tenantMember ? undefined : session.userRole,
  }));
}
