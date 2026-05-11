import 'reflect-metadata';
import { IsNull } from 'typeorm';
import { AppDataSource } from '@/libs/typeorm';
import { AppError, ErrorCode } from '@/libs/app-error';
import { TenantMember as TenantMemberEntity } from './entities/TenantMember';
import { SafeTenantMember, SafeTenantMemberSchema } from './tenant_member.types';
import { AddMemberInput, UpdateMemberRoleInput, GetMembersInput } from './tenant_member.dto';
import { TenantMemberMessages } from './tenant_member.messages';
import type { TenantMemberRole } from './tenant_member.enums';

// Role hierarchy: OWNER(0) > ADMIN(1) > USER(2)
// Lower index = higher privilege
const ROLE_HIERARCHY: TenantMemberRole[] = ['OWNER', 'ADMIN', 'USER'];

export default class TenantMemberService {
  private static get repo() {
    return AppDataSource.getRepository(TenantMemberEntity);
  }

  static omitSensitiveFields(member: TenantMemberEntity): SafeTenantMember {
    return SafeTenantMemberSchema.parse(member);
  }

  /**
   * Add a user to a tenant. Throws if already a member.
   */
  static async addMember(data: AddMemberInput): Promise<SafeTenantMember> {
    const existing = await TenantMemberService.repo.findOne({
      where: { tenantId: data.tenantId, userId: data.userId },
    });

    if (existing) {
      throw new AppError(
        TenantMemberMessages.MEMBER_ALREADY_EXISTS,
        409,
        ErrorCode.CONFLICT,
      );
    }

    const member = TenantMemberService.repo.create({
      tenantId: data.tenantId,
      userId: data.userId,
      memberRole: data.memberRole,
      memberStatus: 'ACTIVE',
      joinedAt: new Date(),
    });

    const saved = await TenantMemberService.repo.save(member);
    return SafeTenantMemberSchema.parse(saved);
  }

  /**
   * Find a member by tenantId + userId. Returns null if not found.
   */
  static async findByTenantAndUser(
    tenantId: string,
    userId: string,
  ): Promise<TenantMemberEntity | null> {
    return TenantMemberService.repo.findOne({
      where: { tenantId, userId },
    });
  }

  /**
   * List all members of a tenant with pagination.
   */
  static async findByTenant(
    data: GetMembersInput,
  ): Promise<{ members: SafeTenantMember[]; total: number }> {
    const { tenantId, page, limit } = data;
    const skip = (page - 1) * limit;

    const [members, total] = await TenantMemberService.repo.findAndCount({
      where: { tenantId },
      skip,
      take: limit,
      order: { joinedAt: 'ASC' },
    });

    return {
      members: members.map((m) => SafeTenantMemberSchema.parse(m)),
      total,
    };
  }

  /**
   * Find all tenant memberships for a given user.
   */
  static async findByUser(userId: string): Promise<SafeTenantMember[]> {
    const members = await TenantMemberService.repo.find({
      where: { userId, memberStatus: 'ACTIVE' },
      order: { joinedAt: 'DESC' },
    });

    return members.map((m) => SafeTenantMemberSchema.parse(m));
  }

  /**
   * Update a member's role. The OWNER role cannot be changed.
   */
  static async updateRole(
    tenantId: string,
    userId: string,
    memberRole: TenantMemberRole,
  ): Promise<SafeTenantMember> {
    const member = await TenantMemberService.repo.findOne({
      where: { tenantId, userId },
    });

    if (!member) {
      throw new AppError(
        TenantMemberMessages.MEMBER_NOT_FOUND,
        404,
        ErrorCode.NOT_FOUND,
      );
    }

    if (member.memberRole === 'OWNER') {
      throw new AppError(
        TenantMemberMessages.CANNOT_REMOVE_OWNER,
        403,
        ErrorCode.FORBIDDEN,
      );
    }

    await TenantMemberService.repo.update(
      { tenantId, userId },
      { memberRole },
    );

    const updated = await TenantMemberService.repo.findOne({
      where: { tenantId, userId },
    });

    return SafeTenantMemberSchema.parse(updated!);
  }

  /**
   * Remove a member from a tenant. The OWNER cannot be removed.
   */
  static async removeMember(tenantId: string, userId: string): Promise<void> {
    const member = await TenantMemberService.repo.findOne({
      where: { tenantId, userId },
    });

    if (!member) {
      throw new AppError(
        TenantMemberMessages.MEMBER_NOT_FOUND,
        404,
        ErrorCode.NOT_FOUND,
      );
    }

    if (member.memberRole === 'OWNER') {
      throw new AppError(
        TenantMemberMessages.CANNOT_REMOVE_OWNER,
        403,
        ErrorCode.FORBIDDEN,
      );
    }

    await TenantMemberService.repo.delete({ tenantId, userId });
  }

  /**
   * Check whether a user has at least the required role.
   * Returns true if the user's role is >= requiredRole in the hierarchy.
   */
  static async checkPermission(
    tenantId: string,
    userId: string,
    requiredRole: TenantMemberRole,
  ): Promise<boolean> {
    const member = await TenantMemberService.repo.findOne({
      where: { tenantId, userId, memberStatus: 'ACTIVE' },
    });

    if (!member) return false;

    const memberIdx = ROLE_HIERARCHY.indexOf(member.memberRole as TenantMemberRole);
    const requiredIdx = ROLE_HIERARCHY.indexOf(requiredRole);

    return memberIdx !== -1 && memberIdx <= requiredIdx;
  }

  /**
   * Assert that a user has at least the required role.
   * Throws 403 if not.
   */
  static async assertPermission(
    tenantId: string,
    userId: string,
    requiredRole: TenantMemberRole,
  ): Promise<void> {
    const hasPermission = await TenantMemberService.checkPermission(
      tenantId,
      userId,
      requiredRole,
    );

    if (!hasPermission) {
      throw new AppError(
        TenantMemberMessages.INSUFFICIENT_PERMISSIONS,
        403,
        ErrorCode.FORBIDDEN,
      );
    }
  }

  /**
   * Get total number of members in a tenant.
   */
  static async getMemberCount(tenantId: string): Promise<number> {
    return TenantMemberService.repo.count({ where: { tenantId } });
  }
}
