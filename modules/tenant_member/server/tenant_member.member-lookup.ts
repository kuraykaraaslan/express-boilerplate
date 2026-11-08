import 'reflect-metadata';
import { Brackets, type SelectQueryBuilder } from 'typeorm';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { escapeLike } from '@kuraykaraaslan-labs/common/server/common.list-query';
import { ifActive } from '@kuraykaraaslan-labs/common/server/extensions/optional-module';
import {
  MEMBER_RESOLVE_MAX, MEMBER_SEARCH_MAX, type MemberLookup, type MemberRef,
} from '@kuraykaraaslan-labs/common/server/common.member-lookup';
import { User as UserEntity } from '@kuraykaraaslan-labs/user/server/entities/user.entity';
import { TenantMember as TenantMemberEntity } from './entities/tenant_member.entity';
import { profileNameOf } from './tenant_member.peer-view';

/**
 * `tenant_member` as the answer to "who is this user id" for modules that store one without owning people (point `common:member_lookup`;
 * loyalty's accounts list). Membership is read here, tenant-scoped through the tenant repository: only the tenant's ACTIVE, not deleted members
 * whose account still exists, never anyone else's. The e-mail is the account's (`users`); the name is the profile's (`user_profiles`, the
 * display name, else the name, else given + family name, as the members list shows it), read only while `user_profile` is active for the tenant
 * (`dependencies.optional`): without it a member has no name and a search matches e-mails only.
 *
 * The contract's bounds are enforced here as well as in common's helper: a search answers at most 25 members, a resolve takes at most 200 ids.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = {
  userId: string;
  email: string | null;
  displayName?: string | null;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
};

/** The profile entity when `user_profile` is active for the tenant, else null (names are then unknown). */
async function profileEntity(tenantId: string): Promise<(new () => unknown) | null> {
  try {
    const mod = await ifActive(tenantId, 'user_profile', () => import('@kuraykaraaslan-labs/user_profile/server/entities/user_profile.entity'));
    return (mod?.UserProfile as (new () => unknown) | undefined) ?? null;
  } catch {
    return null;
  }
}

/** The tenant's ACTIVE members (with their account and, when readable, their profile), narrowed by `narrow`, at most `limit` rows. */
async function activeMembers(
  tenantId: string, limit: number,
  narrow: (qb: SelectQueryBuilder<TenantMemberEntity>, withProfile: boolean) => void,
): Promise<MemberRef[]> {
  const Profile = await profileEntity(tenantId);
  const rows = await withTenantRepositoryFor(tenantId, TenantMemberEntity, (repo) => {
    const qb = repo.createQueryBuilder('m')
      .innerJoin(UserEntity, 'u', 'u.userId = m.userId AND u.deletedAt IS NULL')
      .select('m.userId', 'userId')
      .addSelect('u.email', 'email')
      .where('m.tenantId = :tenantId', { tenantId })
      .andWhere('m.deletedAt IS NULL')
      .andWhere("m.memberStatus = 'ACTIVE'");
    if (Profile) {
      qb.leftJoin(Profile, 'p', 'p.userId = m.userId')
        .addSelect('p.displayName', 'displayName')
        .addSelect('p.name', 'name')
        .addSelect('p.firstName', 'firstName')
        .addSelect('p.lastName', 'lastName');
    }
    narrow(qb, !!Profile);
    return qb.orderBy('u.email', 'ASC').addOrderBy('m.userId', 'ASC').limit(limit).getRawMany<Row>();
  });
  return rows.map(toRef);
}

/** One raw row as a MemberRef. */
export function toRef(row: Row): MemberRef {
  return {
    userId: row.userId,
    name: profileNameOf({ userProfile: { displayName: row.displayName, name: row.name, firstName: row.firstName, lastName: row.lastName } }),
    email: row.email ?? null,
  };
}

const lookup: MemberLookup = {
  async search(tenantId, text, opts) {
    const q = typeof text === 'string' ? text.trim().slice(0, 200) : '';
    if (!q) return [];
    const limit = Math.min(MEMBER_SEARCH_MAX, Math.max(1, Math.floor(opts?.limit ?? MEMBER_SEARCH_MAX)));
    const like = `%${escapeLike(q)}%`;
    const nameOnly = opts?.match === 'name';
    return activeMembers(tenantId, limit, (qb, withProfile) => {
      qb.andWhere(new Brackets((w) => {
        // `match: 'name'` never matches the e-mail, so the limit counts name matches only; with no profile to read
        // names from nobody matches (docs/phases/41-ui-fixes/10 3.3).
        if (nameOnly) w.where('1 = 0');
        else w.where('u.email ILIKE :like', { like });
        if (withProfile) {
          w.orWhere('p.displayName ILIKE :like', { like })
            .orWhere('p.name ILIKE :like', { like })
            .orWhere("CONCAT_WS(' ', p.firstName, p.lastName) ILIKE :like", { like })
            .orWhere("CONCAT_WS(' ', p.lastName, p.firstName) ILIKE :like", { like });
        }
      }));
    });
  },

  async resolve(tenantId, userIds) {
    const ids = [...new Set((Array.isArray(userIds) ? userIds : [])
      .filter((id): id is string => typeof id === 'string' && UUID_RE.test(id))
      .map((id) => id.toLowerCase()))].slice(0, MEMBER_RESOLVE_MAX);
    if (ids.length === 0) return [];
    return activeMembers(tenantId, ids.length, (qb) => { qb.andWhere('m.userId IN (:...ids)', { ids }); });
  },
};

export default lookup;
