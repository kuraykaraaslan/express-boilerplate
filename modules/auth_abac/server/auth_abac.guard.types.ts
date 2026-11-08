import type { NextRequest } from 'next/server';
import type { TenantMemberRole } from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.enums';
import type { SafeUser } from '@kuraykaraaslan-labs/user/server/user.types';
import type { UserRole } from '@kuraykaraaslan-labs/user/server/user.enums';
import type { SafeTenantMember } from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.types';
import type { SafeTenant } from '@kuraykaraaslan-labs/tenant/server/tenant.types';
import type { SafeUserSession } from '@kuraykaraaslan-labs/user_session/server/user_session.types';
import type { AttributeBag } from './auth_abac.types';

export interface AuthorizeArgs {
  request: NextRequest;
  tenantId: string;
  /** A permission id from the acting module's catalog, e.g. `dynamic_page.pages.update`. */
  requiredPermission: string;
  /** Optional resource for attribute-based policies (owner/status checks). */
  resource?: { type: string } & AttributeBag;
  /** Disable the decision cache (time-dependent policies). */
  cache?: boolean;
}

/**
 * The authorization scope — the axis that selects how the caller is authenticated
 * before the ABAC permission check:
 *
 *  - `GUEST`   — anonymous-tolerant; nullable identity (public routes).
 *  - `ACCOUNT` — a logged-in user with NO tenant membership (self-service /
 *                account routes); authenticated via the user session, permission
 *                evaluated against the platform (ROOT) policy set, subject role =
 *                the platform `user.userRole`.
 *  - `TENANT`  — a tenant member at the permission's coarse floor.
 *  - `ROOT`    — a root-tenant super-admin (`authenticateRootTenantAdmin`).
 *  - `GLOBAL`  — a root-tenant super-admin BEHIND the KD-13 admin gate
 *                (IP allowlist + MFA); the hardened counterpart of `ROOT`.
 */
export type AuthorizationScope = 'GUEST' | 'ACCOUNT' | 'TENANT' | 'ROOT' | 'GLOBAL';

/** Fields shared by every scope. */
export interface AuthorizeRequestBase {
  request: NextRequest;
  /** A permission id from the acting module's catalog, e.g. `order.orders.read`. */
  requiredPermission: string;
  /** Override the coarse role floor; defaults to the permission's catalog `minRole`. */
  requiredTenantRole?: TenantMemberRole;
  /** Optional resource for attribute-based policies (owner/status checks). */
  resource?: { type: string } & AttributeBag;
  /** Enable the (env-keyed) decision cache — off by default; see the adapter. */
  cache?: boolean;
  /**
   * Accept an MCP OAuth access token (`Bearer mcp_at_…`) on this TENANT route (docs/phases/57-mcp-server D57-8). Only the MCP servers set
   * it; on every other route such a token is refused 401.
   */
  allowMcpGrant?: boolean;
}

/**
 * TENANT scope: a real tenant, non-null identity. `scope` is REQUIRED so an
 * OMITTED scope does NOT match this overload (it falls to the widest, nullable
 * one) — this is what keeps runtime-derived scope and static narrowing compatible.
 */
export interface AuthorizeTenantArgs extends AuthorizeRequestBase {
  tenantId: string;
  scope: 'TENANT';
}

/** GUEST scope: anonymous-tolerant; nullable identity; never throws on missing auth. */
export interface AuthorizeGuestArgs extends AuthorizeRequestBase {
  tenantId: string;
  scope: 'GUEST';
}

/**
 * ROOT scope: super-admin (a member of the root tenant). `tenantId` is OPTIONAL — it
 * defaults to `ROOT_TENANT_ID` (the root tenant IS the scope).
 */
export interface AuthorizeRootArgs extends AuthorizeRequestBase {
  tenantId?: string;
  scope: 'ROOT';
}

/**
 * GLOBAL scope: root-tenant super-admin behind the KD-13 admin gate (IP allowlist
 * + MFA). `tenantId` is OPTIONAL — the policy is evaluated against `ROOT_TENANT_ID`.
 */
export interface AuthorizeGlobalArgs extends AuthorizeRequestBase {
  tenantId?: string;
  scope: 'GLOBAL';
}

/**
 * ACCOUNT scope: a logged-in user with NO tenant membership (self-service). The
 * user is authenticated from the user session and the permission is evaluated
 * against the platform (`ROOT_TENANT_ID`) policy set. `tenantId` is optional and
 * NOT used for the decision. Never permit-anonymous — it throws when unauthenticated.
 */
export interface AuthorizeAccountArgs extends AuthorizeRequestBase {
  tenantId?: string;
  scope: 'ACCOUNT';
  /** Platform user-role floor for the account holder; defaults to 'USER'. */
  requiredUserRole?: UserRole;
}

/**
 * Scope OMITTED: derived at runtime from the permission's catalog `minRole`. Typed
 * as the widest (nullable) result because TS cannot statically know GUEST-vs-TENANT.
 * Pass an explicit `scope` when you need the narrowed, non-null result type.
 */
export interface AuthorizeDerivedArgs extends AuthorizeRequestBase {
  tenantId: string;
  scope?: undefined;
}

/**
 * The result of a GUEST authorization. Identity is OPTIONAL: `user` / `tenantMember`
 * / `tenant` are null for an anonymous caller (present when a valid session
 * accompanies the public request — e.g. a logged-in user hitting a storefront route).
 */
export interface PublicAuthResult {
  user: SafeUser | null;
  tenantMember: SafeTenantMember | null;
  tenant: SafeTenant | null;
  isGlobalAdmin?: boolean;
}

/**
 * The result of an ACCOUNT authorization. The user is always present (the guard
 * throws when unauthenticated); `tenant`/`tenantMember` are always null because
 * the caller is acting on their own account, outside any tenant membership.
 */
export interface AccountAuthResult {
  user: SafeUser;
  userSession: SafeUserSession;
  tenant: null;
  tenantMember: null;
}
