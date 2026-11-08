/**
 * Storage of the MCP authorization server (docs/phases/57-mcp-server D57-8). Authorization codes and access tokens live in Redis under
 * the SHA-256 of the raw value (a code for 60 s and taken once with GETDEL; an access token for 10 minutes); grants live in the tenant's
 * `mcp_oauth_grants` table under its RLS. Nothing stored here can be replayed as a token.
 */
import 'reflect-metadata';
import type { QueryRunner } from 'typeorm';
import { withTenantTransactionFor } from '@kuraykaraaslan-labs/db';

export const AUTH_CODE_SECONDS = 60;
export const ACCESS_TOKEN_SECONDS = 600;
export const GRANT_LIFETIME_DAYS = 90;

export interface PendingCode {
  tenantId: string;
  userId: string;
  clientId: string;
  clientName: string;
  clientHost: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  scope: string;
}

export interface AccessTokenRecord {
  tenantId: string;
  grantId: string;
  userId: string;
  clientId: string;
  resource: string;
  scope: string;
}

export type GrantStatus = 'active' | 'suspended' | 'revoked';

export interface GrantRow {
  grantId: string;
  tenantId: string;
  userId: string;
  clientId: string;
  clientName: string;
  clientHost: string;
  resource: string;
  scope: string;
  status: GrantStatus;
  suspendedUntil: Date | null;
  refreshHash: string | null;
  previousRefreshHash: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
}

export interface NewGrant {
  tenantId: string;
  userId: string;
  clientId: string;
  clientName: string;
  clientHost: string;
  resource: string;
  scope: string;
  refreshHash: string;
  expiresAt: Date;
}

export interface GrantListQuery {
  userId?: string;
  page: number;
  pageSize: number;
  sort: 'createdAt' | 'lastUsedAt' | 'clientName';
  dir: 'asc' | 'desc';
  search?: string;
  status?: GrantStatus[];
}

export interface OauthStore {
  putCode(hash: string, code: PendingCode): Promise<void>;
  takeCode(hash: string): Promise<PendingCode | null>;
  putAccessToken(hash: string, rec: AccessTokenRecord): Promise<void>;
  getAccessToken(hash: string): Promise<AccessTokenRecord | null>;
  dropAccessToken(hash: string): Promise<void>;
  insertGrant(g: NewGrant): Promise<GrantRow>;
  grantById(tenantId: string, grantId: string): Promise<GrantRow | null>;
  grantByRefresh(tenantId: string, refreshHash: string): Promise<GrantRow | null>;
  grantByPreviousRefresh(tenantId: string, refreshHash: string): Promise<GrantRow | null>;
  /** Swaps the refresh hash only when it is still `expected` (a concurrent refresh loses). */
  rotateRefresh(tenantId: string, grantId: string, expected: string, next: string): Promise<boolean>;
  setStatus(tenantId: string, grantId: string, patch: { status: GrantStatus; suspendedUntil?: Date | null; revokedReason?: string | null }): Promise<boolean>;
  touch(tenantId: string, grantId: string, at: Date): Promise<void>;
  listGrants(tenantId: string, q: GrantListQuery): Promise<{ data: GrantRow[]; total: number }>;
  purgeTenant(tenantId: string): Promise<number>;
  grantsOfUser(tenantId: string, userId: string): Promise<number>;
  deleteGrantsOfUser(tenantId: string, userId: string): Promise<number>;
}

const tx = <T>(tenantId: string, fn: (qr: QueryRunner) => Promise<T>): Promise<T> => withTenantTransactionFor(tenantId, fn);
const rowsOf = (r: unknown): Array<Record<string, unknown>> => (Array.isArray(r) && Array.isArray(r[0]) ? (r[0] as Array<Record<string, unknown>>) : (r as Array<Record<string, unknown>>));
const countOf = (r: unknown): number => (Array.isArray(r) && typeof r[1] === 'number' ? r[1] : 0);
const d = (v: unknown): Date | null => (v ? new Date(v as string) : null);

export function grantOf(r: Record<string, unknown>): GrantRow {
  return {
    grantId: String(r.grantId), tenantId: String(r.tenantId), userId: String(r.userId), clientId: String(r.clientId),
    clientName: String(r.clientName), clientHost: String(r.clientHost), resource: String(r.resource), scope: String(r.scope),
    status: r.status as GrantStatus, suspendedUntil: d(r.suspendedUntil), refreshHash: r.refreshHash ? String(r.refreshHash).trim() : null,
    previousRefreshHash: r.previousRefreshHash ? String(r.previousRefreshHash).trim() : null, createdAt: d(r.createdAt)!,
    lastUsedAt: d(r.lastUsedAt), expiresAt: d(r.expiresAt)!, revokedAt: d(r.revokedAt), revokedReason: (r.revokedReason as string | null) ?? null,
  };
}

const redis = async () => (await import('@kuraykaraaslan-labs/redis')).default;
const parse = <T>(raw: string | null): T | null => {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
};

const SORT_COLUMN: Record<GrantListQuery['sort'], string> = { createdAt: '"createdAt"', lastUsedAt: '"lastUsedAt"', clientName: '"clientName"' };

export const oauthStore: OauthStore = {
  async putCode(hash, code) { await (await redis()).set(`mcp:code:${hash}`, JSON.stringify(code), 'EX', AUTH_CODE_SECONDS); },
  async takeCode(hash) { return parse<PendingCode>(await (await redis()).getdel(`mcp:code:${hash}`)); },
  async putAccessToken(hash, rec) { await (await redis()).set(`mcp:at:${hash}`, JSON.stringify(rec), 'EX', ACCESS_TOKEN_SECONDS); },
  async getAccessToken(hash) { return parse<AccessTokenRecord>(await (await redis()).get(`mcp:at:${hash}`)); },
  async dropAccessToken(hash) { await (await redis()).del(`mcp:at:${hash}`); },

  insertGrant: (g) => tx(g.tenantId, async (qr) => {
    const r = rowsOf(await qr.query(
      `INSERT INTO "mcp_oauth_grants" ("tenantId", "userId", "clientId", "clientName", "clientHost", "resource", "scope", "refreshHash", "expiresAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [g.tenantId, g.userId, g.clientId, g.clientName, g.clientHost, g.resource, g.scope, g.refreshHash, g.expiresAt],
    ));
    return grantOf(r[0]!);
  }),
  grantById: (tenantId, grantId) => tx(tenantId, async (qr) => {
    const r = rowsOf(await qr.query(`SELECT * FROM "mcp_oauth_grants" WHERE "tenantId" = $1 AND "grantId" = $2`, [tenantId, grantId]));
    return r[0] ? grantOf(r[0]) : null;
  }),
  grantByRefresh: (tenantId, hash) => tx(tenantId, async (qr) => {
    const r = rowsOf(await qr.query(`SELECT * FROM "mcp_oauth_grants" WHERE "tenantId" = $1 AND "refreshHash" = $2`, [tenantId, hash]));
    return r[0] ? grantOf(r[0]) : null;
  }),
  grantByPreviousRefresh: (tenantId, hash) => tx(tenantId, async (qr) => {
    const r = rowsOf(await qr.query(`SELECT * FROM "mcp_oauth_grants" WHERE "tenantId" = $1 AND "previousRefreshHash" = $2 LIMIT 1`, [tenantId, hash]));
    return r[0] ? grantOf(r[0]) : null;
  }),
  rotateRefresh: (tenantId, grantId, expected, next) => tx(tenantId, async (qr) => countOf(await qr.query(
    `UPDATE "mcp_oauth_grants" SET "previousRefreshHash" = "refreshHash", "refreshHash" = $4, "lastUsedAt" = now()
     WHERE "tenantId" = $1 AND "grantId" = $2 AND "refreshHash" = $3 AND "status" = 'active'`,
    [tenantId, grantId, expected, next],
  )) === 1),
  setStatus: (tenantId, grantId, patch) => tx(tenantId, async (qr) => countOf(await qr.query(
    `UPDATE "mcp_oauth_grants" SET "status" = $3,
       "suspendedUntil" = CASE WHEN $3 = 'suspended' THEN $4::timestamptz ELSE NULL END,
       "revokedAt" = CASE WHEN $3 = 'revoked' THEN now() ELSE "revokedAt" END,
       "revokedReason" = CASE WHEN $3 = 'revoked' THEN $5 ELSE "revokedReason" END,
       "refreshHash" = CASE WHEN $3 = 'revoked' THEN NULL ELSE "refreshHash" END
     WHERE "tenantId" = $1 AND "grantId" = $2 AND "status" <> 'revoked'`,
    [tenantId, grantId, patch.status, patch.suspendedUntil ?? null, patch.revokedReason ?? null],
  )) === 1),
  touch: (tenantId, grantId, at) => tx(tenantId, async (qr) => {
    await qr.query(
      `UPDATE "mcp_oauth_grants" SET "lastUsedAt" = $3 WHERE "tenantId" = $1 AND "grantId" = $2 AND ("lastUsedAt" IS NULL OR "lastUsedAt" < $3 - interval '1 minute')`,
      [tenantId, grantId, at],
    );
  }),
  listGrants: (tenantId, q) => tx(tenantId, async (qr) => {
    const where: string[] = ['"tenantId" = $1'];
    const params: unknown[] = [tenantId];
    if (q.userId) { params.push(q.userId); where.push(`"userId" = $${params.length}`); }
    if (q.status?.length) { params.push(q.status); where.push(`"status" = ANY($${params.length})`); }
    if (q.search) { params.push(`%${q.search.replace(/[%_\\]/g, (c) => `\\${c}`)}%`); where.push(`("clientName" ILIKE $${params.length} OR "clientHost" ILIKE $${params.length})`); }
    const clause = where.join(' AND ');
    const total = Number(rowsOf(await qr.query(`SELECT count(*)::int AS n FROM "mcp_oauth_grants" WHERE ${clause}`, params))[0]?.n ?? 0);
    const order = `${SORT_COLUMN[q.sort]} ${q.dir === 'asc' ? 'ASC' : 'DESC'} NULLS LAST, "grantId" ASC`;
    params.push(q.pageSize, q.page * q.pageSize);
    const data = rowsOf(await qr.query(
      `SELECT * FROM "mcp_oauth_grants" WHERE ${clause} ORDER BY ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`, params,
    )).map(grantOf);
    return { data, total };
  }),
  purgeTenant: (tenantId) => tx(tenantId, async (qr) => countOf(await qr.query(`DELETE FROM "mcp_oauth_grants" WHERE "tenantId" = $1`, [tenantId]))),
  grantsOfUser: (tenantId, userId) => tx(tenantId, async (qr) =>
    Number(rowsOf(await qr.query(`SELECT count(*)::int AS n FROM "mcp_oauth_grants" WHERE "tenantId" = $1 AND "userId" = $2`, [tenantId, userId]))[0]?.n ?? 0)),
  deleteGrantsOfUser: (tenantId, userId) => tx(tenantId, async (qr) =>
    countOf(await qr.query(`DELETE FROM "mcp_oauth_grants" WHERE "tenantId" = $1 AND "userId" = $2`, [tenantId, userId]))),
};
