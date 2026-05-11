import 'reflect-metadata';
import crypto from 'crypto';
import { LessThan, FindOptionsWhere } from 'typeorm';
import { env } from '@/libs/env';
import { AppDataSource } from '@/libs/typeorm';
import { AppError, ErrorCode } from '@/libs/app-error';
import { TenantInvitation as TenantInvitationEntity } from './entities/TenantInvitation';
import { TenantInvitation, TenantInvitationSchema } from './tenant_invitation.types';
import { CreateInvitationInput, GetInvitationsInput } from './tenant_invitation.dto';
import { TenantInvitationMessages } from './tenant_invitation.messages';
import TenantMemberService from '@/modules/tenant_member/tenant_member.service';
import type { TenantMemberRole } from '@/modules/tenant_member/tenant_member.enums';

const INVITATION_TTL_SECONDS: number = env.INVITATION_TTL_SECONDS ?? 60 * 60 * 24 * 7;

export default class TenantInvitationService {
  private static get repo() {
    return AppDataSource.getRepository(TenantInvitationEntity);
  }

  /**
   * Hash a raw token with SHA-256.
   */
  static hashToken(rawToken: string): string {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
  }

  /**
   * Generate a cryptographically random token (hex).
   */
  static generateRawToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Create and send an invitation.
   * Revokes any existing pending invitation for the same email+tenantId.
   * Returns the invitation and the raw (un-hashed) token.
   */
  static async create(
    data: CreateInvitationInput,
    invitedBy: string,
  ): Promise<{ invitation: TenantInvitation; rawToken: string }> {
    const normalizedEmail = data.email.toLowerCase();

    // Check if the user is already a member
    const existing = await TenantInvitationService.repo.findOne({
      where: {
        tenantId: data.tenantId,
        email: normalizedEmail,
        status: 'PENDING',
      },
    });

    if (existing) {
      // Expire the old pending invitation before creating a new one
      await TenantInvitationService.repo.update(
        { tenantId: data.tenantId, email: normalizedEmail, status: 'PENDING' },
        { status: 'EXPIRED' },
      );
    }

    const rawToken = TenantInvitationService.generateRawToken();
    const hashedToken = TenantInvitationService.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + INVITATION_TTL_SECONDS * 1000);

    const memberRole = data.memberRole ?? 'USER';

    const invitation = TenantInvitationService.repo.create({
      tenantId: data.tenantId,
      email: normalizedEmail,
      invitedBy,
      memberRole,
      token: hashedToken,
      status: 'PENDING',
      expiresAt,
    });

    const saved = await TenantInvitationService.repo.save(invitation);
    return { invitation: TenantInvitationSchema.parse(saved), rawToken };
  }

  /**
   * Find an invitation by raw token (hashes internally before lookup).
   */
  static async findByToken(rawToken: string): Promise<TenantInvitation> {
    const hashed = TenantInvitationService.hashToken(rawToken);

    const invitation = await TenantInvitationService.repo.findOne({
      where: { token: hashed },
    });

    if (!invitation) {
      throw new AppError(
        TenantInvitationMessages.INVITATION_NOT_FOUND,
        404,
        ErrorCode.NOT_FOUND,
      );
    }

    return TenantInvitationSchema.parse(invitation);
  }

  /**
   * Accept an invitation by raw token.
   * Validates expiry and status, then adds the user as a tenant member.
   */
  static async accept(rawToken: string, userId: string): Promise<void> {
    const hashed = TenantInvitationService.hashToken(rawToken);

    const invitation = await TenantInvitationService.repo.findOne({
      where: { token: hashed },
    });

    if (!invitation) {
      throw new AppError(
        TenantInvitationMessages.INVITATION_NOT_FOUND,
        404,
        ErrorCode.NOT_FOUND,
      );
    }

    if (invitation.status === 'ACCEPTED') {
      throw new AppError(
        TenantInvitationMessages.INVITATION_ALREADY_ACCEPTED,
        409,
        ErrorCode.CONFLICT,
      );
    }

    if (invitation.status === 'EXPIRED' || invitation.expiresAt < new Date()) {
      throw new AppError(
        TenantInvitationMessages.INVITATION_EXPIRED,
        410,
        ErrorCode.NOT_FOUND,
      );
    }

    // Check if already a member
    const alreadyMember = await TenantMemberService.findByTenantAndUser(
      invitation.tenantId,
      userId,
    );

    if (alreadyMember) {
      throw new AppError(
        TenantInvitationMessages.INVITATION_ALREADY_MEMBER,
        409,
        ErrorCode.CONFLICT,
      );
    }

    await TenantMemberService.addMember({
      tenantId: invitation.tenantId,
      userId,
      memberRole: invitation.memberRole as TenantMemberRole,
    });

    await TenantInvitationService.repo.update(
      { invitationId: invitation.invitationId },
      { status: 'ACCEPTED' },
    );
  }

  /**
   * Decline an invitation by raw token.
   */
  static async decline(rawToken: string): Promise<void> {
    const hashed = TenantInvitationService.hashToken(rawToken);

    const invitation = await TenantInvitationService.repo.findOne({
      where: { token: hashed },
    });

    if (!invitation) {
      throw new AppError(
        TenantInvitationMessages.INVITATION_NOT_FOUND,
        404,
        ErrorCode.NOT_FOUND,
      );
    }

    if (invitation.status !== 'PENDING') {
      throw new AppError(
        TenantInvitationMessages.INVITATION_ALREADY_ACCEPTED,
        409,
        ErrorCode.CONFLICT,
      );
    }

    await TenantInvitationService.repo.update(
      { invitationId: invitation.invitationId },
      { status: 'DECLINED' },
    );
  }

  /**
   * Expire all invitations past their expiresAt date that are still PENDING.
   * Intended to be called by a cron job.
   */
  static async expireOld(): Promise<void> {
    await TenantInvitationService.repo.update(
      {
        status: 'PENDING',
        expiresAt: LessThan(new Date()),
      },
      { status: 'EXPIRED' },
    );
  }

  /**
   * List invitations for a tenant with optional status filter and pagination.
   */
  static async findByTenant(
    data: GetInvitationsInput,
  ): Promise<{ invitations: TenantInvitation[]; total: number }> {
    const { tenantId, status, page, limit } = data;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { tenantId };
    if (status) where.status = status;

    const [rows, total] = await TenantInvitationService.repo.findAndCount({
      where: where as FindOptionsWhere<TenantInvitationEntity>,
      skip,
      take: limit,
      order: { createdAt: 'DESC' },
    });

    return {
      invitations: rows.map((r) => TenantInvitationSchema.parse(r)),
      total,
    };
  }

  /**
   * Revoke (cancel) a specific invitation by invitationId.
   */
  static async revokeInvitation(invitationId: string): Promise<void> {
    const invitation = await TenantInvitationService.repo.findOne({
      where: { invitationId },
    });

    if (!invitation) {
      throw new AppError(
        TenantInvitationMessages.INVITATION_NOT_FOUND,
        404,
        ErrorCode.NOT_FOUND,
      );
    }

    await TenantInvitationService.repo.update(
      { invitationId },
      { status: 'EXPIRED' },
    );
  }
}
