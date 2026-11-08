import { withSystemRLS } from '@kuraykaraaslan-labs/db';
import { ext, systemCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { announcementAudienceFacetLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/announcement.audience_facet';
import Logger from '@kuraykaraaslan-labs/logger';
import { AUDIENCE_FACET_POINT, type AudienceFacetOption, type AudienceFacetProvider } from './announcement.types';
import type { AnnouncementAudience } from './entities/announcement.entity';
import AnnouncementMessages from './announcement.messages';
import type { Sender } from './announcement.rules';

/**
 * Who an announcement reaches (D18): the active members of the active tenants it names (every tenant for a platform
 * announcement without a list), narrowed by member role and, for a platform announcement, by the plan and edition facets
 * other modules answer. One person in several tenants is one recipient (D15 plan A: deduplicated by user), delivered in
 * the first tenant they joined of those in the audience.
 *
 * A cross-tenant read by design: it runs on the SYSTEM connection and every filter is written here.
 */

/** A person the fan-out delivers to. */
export interface AudienceMember {
  userId: string;
  /** The tenant the bell entry goes to. */
  tenantId: string;
  /** null when the account has no real mailbox (a Fleet ID placeholder ends in `.invalid`). */
  email: string | null;
  phone: string | null;
  /** user_preferences.language; null = the announcement's default. */
  language: string | null;
}

/** People per fan-out batch. */
export const AUDIENCE_BATCH = 500;

/** The facets every contributor offers, by key (`plan`, `edition`), for the composer. */
export async function audienceFacets(): Promise<Array<{ key: string; label: string; options: AudienceFacetOption[] }>> {
  const { results, failed } = await ext.aggregate<AudienceFacetProvider, AudienceFacetOption[]>(
    AUDIENCE_FACET_POINT, systemCtx('announcement audience facets'), announcementAudienceFacetLoaders,
    (provider) => provider.options(),
  );
  if (failed.length) Logger.warn(`[announcement] audience facets unavailable: ${failed.map((f) => f.moduleId).join(', ')}`);
  return results.map(({ contribution, value }) => ({
    key: contribution.key ?? contribution.moduleId,
    label: String((contribution.metadata as { label?: unknown } | undefined)?.label ?? contribution.key),
    options: value,
  }));
}

/**
 * The tenants a facet's values match. Fails CLOSED: when the facet's provider cannot answer, the send is refused (503)
 * instead of going to people the sender meant to leave out.
 */
async function facetTenants(key: 'plan' | 'edition', values: string[]): Promise<Set<string>> {
  const { results } = await ext.aggregate<AudienceFacetProvider, string[] | null>(
    AUDIENCE_FACET_POINT, systemCtx('announcement audience'), announcementAudienceFacetLoaders,
    (provider, _signal, contribution) => (contribution.key === key ? provider.tenantsMatching(values) : null),
  );
  const answer = results.find((r) => r.contribution.key === key && Array.isArray(r.value));
  if (!answer) throw new AppError(AnnouncementMessages.FACET_UNAVAILABLE, 503, ErrorCode.PROVIDER_UNAVAILABLE);
  return new Set(answer.value);
}

/**
 * The tenant filter of an audience: null = every active tenant. A tenant sender reaches its own tenant whatever the
 * audience says; facets are a platform filter.
 */
export async function audienceTenants(sender: Sender, audience: AnnouncementAudience): Promise<string[] | null> {
  if (sender.tenantId !== null) return [sender.tenantId];
  let tenants: Set<string> | null = audience.tenantIds ? new Set(audience.tenantIds) : null;
  const narrow = (set: Set<string>) => {
    tenants = tenants ? new Set([...tenants].filter((t) => set.has(t))) : set;
  };
  if (audience.plans.length) narrow(await facetTenants('plan', audience.plans));
  if (audience.editions.length) narrow(await facetTenants('edition', audience.editions));
  return tenants ? [...tenants] : null;
}

const MEMBERS_JOIN = `
  FROM "tenant_members" m
  JOIN "tenants" t ON t."tenantId" = m."tenantId" AND t."tenantStatus" = 'ACTIVE'
  JOIN "users" u ON u."userId" = m."userId" AND u."userStatus" = 'ACTIVE'`;
const MEMBERS_WHERE = `
  WHERE m."memberStatus" = 'ACTIVE' AND m."deletedAt" IS NULL
    AND ($1::uuid[] IS NULL OR m."tenantId" = ANY($1::uuid[]))
    AND (cardinality($2::varchar[]) = 0 OR m."memberRole" = ANY($2::varchar[]))`;

/** How many people the audience reaches (the confirm's number). */
export async function countAudience(tenants: string[] | null, roles: string[]): Promise<number> {
  if (tenants && tenants.length === 0) return 0;
  const rows: Array<{ count: string }> = await withSystemRLS((qr) => qr.query(
    `SELECT count(DISTINCT m."userId")::text AS count ${MEMBERS_JOIN} ${MEMBERS_WHERE}`, [tenants, roles],
  ));
  return Number(rows[0]?.count ?? 0);
}

/**
 * The next batch of recipients after `afterUserId`, in user id order (keyset, so a retried fan-out resumes where it
 * stopped). Each person once, in the tenant they joined first.
 */
export async function audienceBatch(
  tenants: string[] | null, roles: string[], afterUserId: string | null, limit = AUDIENCE_BATCH,
): Promise<AudienceMember[]> {
  if (tenants && tenants.length === 0) return [];
  const rows: Array<{ userId: string; tenantId: string; email: string | null; phone: string | null; language: string | null }> =
    await withSystemRLS((qr) => qr.query(
      `SELECT DISTINCT ON (m."userId") m."userId", m."tenantId", u."email", u."phone", p."language"
       ${MEMBERS_JOIN}
       LEFT JOIN "user_preferences" p ON p."userId" = m."userId"
       ${MEMBERS_WHERE}
         AND ($3::uuid IS NULL OR m."userId" > $3::uuid)
       ORDER BY m."userId", m."createdAt" ASC
       LIMIT $4`,
      [tenants, roles, afterUserId, limit],
    ));
  return rows.map((r) => ({
    userId: r.userId,
    tenantId: r.tenantId,
    email: r.email && !r.email.toLowerCase().endsWith('.invalid') ? r.email : null,
    phone: r.phone || null,
    language: r.language || null,
  }));
}
