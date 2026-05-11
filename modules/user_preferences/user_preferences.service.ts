import 'reflect-metadata';

import { AppDataSource } from '@/libs/typeorm';
import { AppError, ErrorCode } from '@/libs/app-error';

import { UserPreferences as UserPreferencesEntity } from './entities/UserPreferences';
import { UserPreferences, UserPreferencesSchema } from './user_preferences.types';
import { UpdateUserPreferencesInput } from './user_preferences.dto';
import { UserPreferencesMessages } from './user_preferences.messages';

export default class UserPreferencesService {

  // ──────────────────────────────────────────────────────────────────────────
  // Find or Create
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Returns existing preferences or creates default ones.
   */
  static async findOrCreate(userId: string): Promise<UserPreferences> {
    const repo = AppDataSource.getRepository(UserPreferencesEntity);
    const existing = await repo.findOne({ where: { userId } });
    if (existing) return UserPreferencesSchema.parse(existing);

    const prefs = repo.create({
      userId,
      language: 'en',
      timezone: 'UTC',
      theme: 'light',
      emailNotifications: true,
      pushNotifications: false,
    });
    const saved = await repo.save(prefs);
    return UserPreferencesSchema.parse(saved);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Read
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Returns preferences for the given userId. Creates defaults if not found.
   */
  static async findByUserId(userId: string): Promise<UserPreferences> {
    return this.findOrCreate(userId);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Update
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Updates mutable preference fields and returns the updated record.
   */
  static async update(userId: string, data: UpdateUserPreferencesInput): Promise<UserPreferences> {
    const repo = AppDataSource.getRepository(UserPreferencesEntity);
    const prefs = await repo.findOne({ where: { userId } });
    if (!prefs) {
      throw new AppError(UserPreferencesMessages.PREFERENCES_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    }

    await repo.update({ userId }, {
      ...(data.language !== undefined && { language: data.language }),
      ...(data.timezone !== undefined && { timezone: data.timezone }),
      ...(data.theme !== undefined && { theme: data.theme }),
      ...(data.emailNotifications !== undefined && { emailNotifications: data.emailNotifications }),
      ...(data.pushNotifications !== undefined && { pushNotifications: data.pushNotifications }),
    });

    const updated = await repo.findOne({ where: { userId } });
    return UserPreferencesSchema.parse(updated!);
  }
}
