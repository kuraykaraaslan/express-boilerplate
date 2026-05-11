import 'reflect-metadata';
import crypto from 'crypto';
import bcrypt from 'bcrypt';

import { AppDataSource } from '@/libs/typeorm';
import { AppError, ErrorCode } from '@/libs/app-error';
import redis from '@/libs/redis';
import { env } from '@/libs/env';

import { User as UserEntity } from '@/modules/user/entities/User';
import { SafeUser, SafeUserSchema } from '@/modules/user/user.types';
import TenantService from '@/modules/tenant/tenant.service';

import AuthMessages from './auth.messages';
import { LoginInput, RegisterInput } from './auth.dto';

export default class AuthService {
  // ── Token helpers ──────────────────────────────────────────────────────────

  static generateToken(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  static async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }

  // ── Role check ─────────────────────────────────────────────────────────────

  public static checkIfUserHasRole(user: SafeUser, requiredRole: string): boolean {
    const roles = ['SUPER_ADMIN', 'ADMIN', 'USER', 'GUEST'];
    const userRoleIndex = roles.indexOf(user.userRole);
    const requiredRoleIndex = roles.indexOf(requiredRole);
    return userRoleIndex <= requiredRoleIndex;
  }

  // ── Login ──────────────────────────────────────────────────────────────────

  static async login(data: LoginInput): Promise<SafeUser> {
    const repo = AppDataSource.getRepository(UserEntity);
    const user = await repo.findOne({ where: { email: data.email.toLowerCase() } });

    if (!user) {
      throw new AppError(AuthMessages.INVALID_EMAIL_OR_PASSWORD, 401, ErrorCode.INVALID_CREDENTIALS);
    }

    const isPasswordValid = await bcrypt.compare(data.password, user.password);
    if (!isPasswordValid) {
      throw new AppError(AuthMessages.INVALID_EMAIL_OR_PASSWORD, 401, ErrorCode.INVALID_CREDENTIALS);
    }

    return SafeUserSchema.parse(user);
  }

  // ── Register ───────────────────────────────────────────────────────────────

  static async register(data: RegisterInput): Promise<SafeUser> {
    const { email, password, phone } = data;

    const repo = AppDataSource.getRepository(UserEntity);
    const existingByEmail = await repo.findOne({ where: { email: email.toLowerCase() } });

    if (existingByEmail) {
      throw new AppError(AuthMessages.EMAIL_ALREADY_EXISTS, 409, ErrorCode.CONFLICT);
    }

    const hashedPassword = await AuthService.hashPassword(password);

    const user = repo.create({
      email: email.toLowerCase(),
      password: hashedPassword,
      phone: phone ?? undefined,
      userRole: 'USER',
      userStatus: 'ACTIVE',
    });

    const saved = await repo.save(user);
    const safeUser = SafeUserSchema.parse(saved);

    // Provision personal tenant
    await TenantService.provisionPersonalTenant(safeUser.userId, safeUser.email);

    return safeUser;
  }

  // ── Email verification ─────────────────────────────────────────────────────

  private static readonly EMAIL_VERIFY_TTL_SECONDS =
    env.EMAIL_VERIFY_TTL_SECONDS ?? 60 * 60 * 24; // 24h

  private static readonly EMAIL_VERIFY_RATE_LIMIT_SECONDS =
    env.EMAIL_VERIFY_RATE_LIMIT_SECONDS ?? 300; // 5min

  private static getEmailVerifyKey(userId: string): string {
    return `email:verify:${userId}`;
  }

  private static getEmailVerifyRateKey(userId: string): string {
    return `email:verify:rate:${userId}`;
  }

  static async sendEmailVerification(userId: string): Promise<void> {
    const repo = AppDataSource.getRepository(UserEntity);
    const user = await repo.findOne({ where: { userId } });

    if (!user) throw new AppError(AuthMessages.USER_NOT_FOUND, 404, ErrorCode.NOT_FOUND);

    const rateKey = AuthService.getEmailVerifyRateKey(userId);
    if (await redis.get(rateKey)) {
      throw new AppError(AuthMessages.RATE_LIMIT_EXCEEDED, 429, ErrorCode.RATE_LIMIT_EXCEEDED);
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

    const verifyKey = AuthService.getEmailVerifyKey(userId);
    await redis.setex(verifyKey, AuthService.EMAIL_VERIFY_TTL_SECONDS, hashedToken);
    await redis.setex(rateKey, AuthService.EMAIL_VERIFY_RATE_LIMIT_SECONDS, '1');

    // TODO: send email with rawToken
    // await MailService.sendVerifyEmail({ email: user.email, verifyToken: rawToken });
  }

  static async verifyEmail(token: string, userId: string): Promise<void> {
    const repo = AppDataSource.getRepository(UserEntity);
    const user = await repo.findOne({ where: { userId } });

    if (!user) throw new AppError(AuthMessages.USER_NOT_FOUND, 404, ErrorCode.NOT_FOUND);

    const verifyKey = AuthService.getEmailVerifyKey(userId);
    const storedHash = await redis.get(verifyKey);

    if (!storedHash) {
      throw new AppError(AuthMessages.VERIFICATION_TOKEN_EXPIRED, 400, ErrorCode.VALIDATION_ERROR);
    }

    const inputHash = crypto.createHash('sha256').update(token).digest('hex');
    if (inputHash !== storedHash) {
      throw new AppError(AuthMessages.INVALID_VERIFICATION_TOKEN, 400, ErrorCode.VALIDATION_ERROR);
    }

    await redis.del(verifyKey);
    await redis.del(AuthService.getEmailVerifyRateKey(userId));
  }
}
