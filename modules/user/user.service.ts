import 'reflect-metadata';
import { ILike } from 'typeorm';
import bcrypt from 'bcrypt';

import { AppDataSource } from '@/libs/typeorm';
import { AppError, ErrorCode } from '@/libs/app-error';

import { User as UserEntity } from './entities/User';
import { User, SafeUser, UserSchema, SafeUserSchema } from './user.types';
import { UserMessages } from './user.messages';
import {
  CreateUserInput,
  UpdateUserInput,
  GetUsersInput,
} from './user.dto';

export default class UserService {
  // ──────────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Strips sensitive fields (password, deletedAt) from a User entity.
   */
  static omitSensitiveFields(user: UserEntity): SafeUser {
    return SafeUserSchema.parse(user);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Create
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Creates a new user after checking email uniqueness and hashing the password.
   */
  static async create(data: CreateUserInput): Promise<SafeUser> {
    const { email, password, phone } = data;

    const repo = AppDataSource.getRepository(UserEntity);

    const existing = await repo.findOne({ where: { email: email.toLowerCase() } });
    if (existing) {
      throw new AppError(UserMessages.EMAIL_ALREADY_EXISTS, 409, ErrorCode.CONFLICT);
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = repo.create({
      email: email.toLowerCase(),
      password: hashedPassword,
      phone: phone ?? undefined,
      userRole: 'USER',
      userStatus: 'ACTIVE',
    });

    const saved = await repo.save(user);
    return this.omitSensitiveFields(saved);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Read – by ID
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Returns a SafeUser (no password) by userId. Throws NOT_FOUND if missing.
   */
  static async findById(userId: string): Promise<SafeUser> {
    const repo = AppDataSource.getRepository(UserEntity);
    const user = await repo.findOne({ where: { userId } });
    if (!user) {
      throw new AppError(UserMessages.USER_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    }
    return this.omitSensitiveFields(user);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Read – by email (includes password for auth)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Returns the full User object including the password hash. Intended for
   * authentication flows only. Throws NOT_FOUND if the email does not exist.
   */
  static async findByEmail(email: string): Promise<User> {
    const repo = AppDataSource.getRepository(UserEntity);
    const user = await repo.findOne({ where: { email: email.toLowerCase() } });
    if (!user) {
      throw new AppError(UserMessages.USER_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    }
    return UserSchema.parse(user);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Update
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Updates a user's mutable fields and returns the updated SafeUser.
   */
  static async update(userId: string, data: UpdateUserInput): Promise<SafeUser> {
    const repo = AppDataSource.getRepository(UserEntity);
    const user = await repo.findOne({ where: { userId } });
    if (!user) {
      throw new AppError(UserMessages.USER_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    }

    await repo.update({ userId }, {
      ...(data.userStatus !== undefined && { userStatus: data.userStatus }),
    });

    const updated = await repo.findOne({ where: { userId } });
    return this.omitSensitiveFields(updated!);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Delete (soft)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Soft-deletes a user by setting deletedAt. Throws NOT_FOUND if missing.
   */
  static async delete(userId: string): Promise<void> {
    const repo = AppDataSource.getRepository(UserEntity);
    const user = await repo.findOne({ where: { userId } });
    if (!user) {
      throw new AppError(UserMessages.USER_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    }
    // TypeORM soft-delete respects @DeleteDateColumn
    await repo.softDelete({ userId });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // List (paginated + search)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Returns a paginated list of SafeUsers plus the total count.
   */
  static async list(data: GetUsersInput): Promise<{ users: SafeUser[]; total: number }> {
    const { page, limit, search } = data;
    const repo = AppDataSource.getRepository(UserEntity);

    const whereConditions = search
      ? [{ email: ILike(`%${search}%`) }]
      : [{}];

    const [users, total] = await Promise.all([
      repo.find({
        where: whereConditions as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        skip: (page - 1) * limit,
        take: limit,
      }),
      repo.count({
        where: whereConditions as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      }),
    ]);

    return { users: users.map((u) => this.omitSensitiveFields(u)), total };
  }
}
