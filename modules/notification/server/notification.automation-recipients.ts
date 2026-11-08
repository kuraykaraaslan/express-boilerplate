import type { ChoicesContribution } from '@kuraykaraaslan-labs/automation_integrations';
import { ROLES } from './notification.automation-members';

/**
 * `automation:choices` contribution: `notification.recipients`, who an `action.notify` row can name (11 §11.5): the three roles
 * (the value is the role, for the `role` kind) and the tenant's ACTIVE members (the value is the user id, for the `user` kind, the label
 * their e-mail). Members are tenant data, so the list reads only the caller's tenant through `tenant_member`, loaded lazily (a protected
 * module, but a unit test or an edge bundle never opens a connection). A failing lookup leaves the roles and drops the members.
 */
const ROLE_LABEL: Record<(typeof ROLES)[number], string> = { OWNER: 'Role: owners', ADMIN: 'Role: admins', USER: 'Role: members' };

async function members(tenantId: string, search: string, limit: number): Promise<Array<{ value: string; label: string }>> {
  try {
    const { getByTenantId } = await import('@kuraykaraaslan-labs/tenant_member/server/tenant_member.read.service');
    const { members: rows } = await getByTenantId({ tenantId, page: 1, pageSize: limit, memberStatus: 'ACTIVE', ...(search && { search }) } as never);
    return rows.map((m) => ({ value: m.userId, label: m.user?.email ?? m.userId }));
  } catch {
    return [];
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const contribution: ChoicesContribution = {
  name: 'notification.recipients',
  // a user is an entity whose owner is itself: a message whose originator is a user, sent to `originator_owner`, reaches that user
  entityType: 'user',
  async ownerOf(_tenantId, id) {
    return UUID.test(id) ? [id.toLowerCase()] : [];
  },
  async list(tenantId, query) {
    const q = (query.q ?? '').trim();
    const limit = query.limit ?? 50;
    const roles = ROLES.filter((r) => !q || r.includes(q.toUpperCase()) || ROLE_LABEL[r].toLowerCase().includes(q.toLowerCase())).map((r) => ({ value: r as string, label: ROLE_LABEL[r] }));
    const users = limit > roles.length ? await members(tenantId, q, limit - roles.length) : [];
    return { items: [...roles, ...users].slice(0, limit) };
  },
  async resolve(_tenantId, ids) {
    // a role has a fixed label; a member's label is their e-mail, which this answer would have to read one by one: the id stands in
    return Object.fromEntries(ids.filter((id) => (ROLES as readonly string[]).includes(id)).map((id) => [id, ROLE_LABEL[id as (typeof ROLES)[number]]]));
  },
};

export default contribution;
