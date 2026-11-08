import 'reflect-metadata';
import { SafeTenantMember } from './tenant_member.types';
import { CreateTenantMemberInput, UpdateTenantMemberInput, GetTenantMembersInput, GetTenantMemberInput } from './tenant_member.dto';
import type { TenantMemberRole } from './tenant_member.enums';
import { resolveDefaultRole, hasRole, checkPermission } from './tenant_member.helpers';
import {
  getByTenantId, getById, getByIdWithUser, getByTenantAndUser, getUserTenants, getMemberStats,
  type MemberStats,
} from './tenant_member.read.service';
import {
  create, update, suspend, unsuspend, touchLastActive, transferOwnership, remove, holdForReview, releaseReview,
} from './tenant_member.write.service';

/**
 * Tenant-member service facade. The implementation is split across focused
 * modules (`tenant_member.helpers` role resolution + permission checks,
 * `tenant_member.read.service` queries, `tenant_member.write.service` mutations
 * + lifecycle); this class preserves the single `TenantMemberService.*` entry
 * point its callers depend on.
 */
export default class TenantMemberService {
  static resolveDefaultRole(tenantId: string): Promise<TenantMemberRole> {
    return resolveDefaultRole(tenantId);
  }

  static getByTenantId(input: GetTenantMembersInput): Promise<{ members: SafeTenantMember[]; total: number }> {
    return getByTenantId(input);
  }

  static getById(tenantMemberId: string, tenantId: string): Promise<SafeTenantMember> {
    return getById(tenantMemberId, tenantId);
  }

  static getByIdWithUser(tenantMemberId: string, tenantId: string): Promise<SafeTenantMember> {
    return getByIdWithUser(tenantMemberId, tenantId);
  }

  static getMemberStats(tenantId: string): Promise<MemberStats> {
    return getMemberStats(tenantId);
  }

  static getByTenantAndUser(input: GetTenantMemberInput): Promise<SafeTenantMember | null> {
    return getByTenantAndUser(input);
  }

  static create(data: CreateTenantMemberInput, actorId?: string): Promise<SafeTenantMember> {
    return create(data, actorId);
  }

  static update(
    tenantMemberId: string,
    tenantId: string,
    data: UpdateTenantMemberInput,
    actorId?: string,
    opts?: { isOwner?: boolean },
  ): Promise<SafeTenantMember> {
    return update(tenantMemberId, tenantId, data, actorId, opts);
  }

  static suspend(
    tenantMemberId: string,
    tenantId: string,
    opts: { reason: string; until?: Date | null; actorId?: string } = { reason: '' },
  ): Promise<SafeTenantMember> {
    return suspend(tenantMemberId, tenantId, opts);
  }

  static unsuspend(tenantMemberId: string, tenantId: string, actorId?: string): Promise<SafeTenantMember> {
    return unsuspend(tenantMemberId, tenantId, actorId);
  }

  /** Phase 55 02.6: the AI firewall's review hold of a new membership (ACTIVE -> PENDING, the run named). See the write service. */
  static holdForReview(tenantMemberId: string, tenantId: string, opts: { marker: string }): Promise<{ held: boolean }> {
    return holdForReview(tenantMemberId, tenantId, opts);
  }

  /** Lifts a review hold while it is still the run's own (PENDING with its marker). */
  static releaseReview(tenantMemberId: string, tenantId: string, marker: string): Promise<boolean> {
    return releaseReview(tenantMemberId, tenantId, marker);
  }

  static touchLastActive(tenantId: string, userId: string): Promise<void> {
    return touchLastActive(tenantId, userId);
  }

  static transferOwnership(tenantId: string, toUserId: string, demoteToRole: TenantMemberRole = 'ADMIN', actorId?: string): Promise<void> {
    return transferOwnership(tenantId, toUserId, demoteToRole, actorId);
  }

  static delete(tenantMemberId: string, tenantId: string, actorId?: string): Promise<void> {
    return remove(tenantMemberId, tenantId, actorId);
  }

  static getUserTenants(userId: string) {
    return getUserTenants(userId);
  }

  static hasRole(member: SafeTenantMember, requiredRole: TenantMemberRole): boolean {
    return hasRole(member, requiredRole);
  }

  static checkPermission(tenantId: string, userId: string, requiredRole: TenantMemberRole): Promise<boolean> {
    return checkPermission(tenantId, userId, requiredRole);
  }
}
