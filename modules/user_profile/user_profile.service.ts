import 'reflect-metadata';

import { AppDataSource } from '@/libs/typeorm';
import { AppError, ErrorCode } from '@/libs/app-error';

import { UserProfile as UserProfileEntity } from './entities/UserProfile';
import { UserProfile, SafeUserProfile, UserProfileSchema, SafeUserProfileSchema } from './user_profile.types';
import { UpdateUserProfileInput } from './user_profile.dto';
import { UserProfileMessages } from './user_profile.messages';

export default class UserProfileService {

  // ──────────────────────────────────────────────────────────────────────────
  // Find or Create
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Returns existing profile or creates a default one.
   */
  static async findOrCreate(userId: string): Promise<UserProfile> {
    const repo = AppDataSource.getRepository(UserProfileEntity);
    const existing = await repo.findOne({ where: { userId } });
    if (existing) return UserProfileSchema.parse(existing);

    const profile = repo.create({
      userId,
      socialLinks: [],
    });
    const saved = await repo.save(profile);
    return UserProfileSchema.parse(saved);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Read
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Returns the safe profile for the given userId. Creates if not found.
   */
  static async findByUserId(userId: string): Promise<SafeUserProfile> {
    const profile = await this.findOrCreate(userId);
    return this.omitSensitiveFields(profile);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Update
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Updates mutable profile fields and returns the updated safe profile.
   */
  static async update(userId: string, data: UpdateUserProfileInput): Promise<SafeUserProfile> {
    const repo = AppDataSource.getRepository(UserProfileEntity);
    const profile = await repo.findOne({ where: { userId } });
    if (!profile) {
      throw new AppError(UserProfileMessages.PROFILE_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    }

    await repo.update({ userId }, {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.lastName !== undefined && { lastName: data.lastName }),
      ...(data.biography !== undefined && { biography: data.biography }),
      ...(data.profilePicture !== undefined && { profilePicture: data.profilePicture }),
      ...(data.headerImage !== undefined && { headerImage: data.headerImage }),
      ...(data.socialLinks !== undefined && { socialLinks: data.socialLinks }),
    });

    const updated = await repo.findOne({ where: { userId } });
    return this.omitSensitiveFields(UserProfileSchema.parse(updated!));
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Safe fields
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Parses a profile through the SafeUserProfileSchema.
   */
  static omitSensitiveFields(profile: UserProfile): SafeUserProfile {
    return SafeUserProfileSchema.parse(profile);
  }
}
