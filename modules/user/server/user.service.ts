import 'reflect-metadata';
import type { User, SafeUser, SafeUserWithRootMembership, UpdateUser } from './user.types';
import type { UserRole } from './user.enums';
import { invalidate } from './user.helpers';
import { getAll, getAllWithRootMembership, getById, getByEmail } from './user.read.service';
import { create, update, remove, erase } from './user.crud.service';
import { merge } from './user.admin.service';
import type { UserIdInput } from './user.ids';

/**
 * User service facade. The implementation is split across focused modules
 * (`user.read.service`, `user.crud.service`, `user.admin.service`, plus the
 * `user.helpers` cache/audit/breach helpers); this class preserves the single
 * `UserService.*` entry point its many callers depend on.
 */
export default class UserService {
  static invalidate(user: { userId: string; email?: string }): Promise<void> {
    return invalidate(user);
  }

  static create(params: {
    email: string; password: string; phone?: string; userRole?: UserRole; checkBreached?: boolean; actorId?: string | null;
  }): Promise<SafeUser> {
    return create(params);
  }

  static getAll(params: Parameters<typeof getAll>[0]): Promise<{ users: SafeUser[]; total: number }> {
    return getAll(params);
  }

  /** GET /users: the platform list with each account's root membership role and status (06-user 2.1). */
  static getAllWithRootMembership(
    params: Parameters<typeof getAllWithRootMembership>[0],
  ): Promise<{ users: SafeUserWithRootMembership[]; total: number }> {
    return getAllWithRootMembership(params);
  }

  /**
   * `UserIdInput`, not `string`: a plain uuid still passes freely, but an id
   * branded into another space is a compile error. Payroll used to look a
   * PAYSLIP's employeeId up here — every row missed, and the surrounding
   * `.catch(() => null)` turned "nobody got their payslip" into silence
   * (audit 2026-08, DEP-03).
   */
  static getById(userId: UserIdInput): Promise<SafeUser> {
    return getById(userId);
  }

  static update(params: { userId: string; data: UpdateUser; actorId?: string | null }): Promise<SafeUser> {
    return update(params);
  }

  static delete(userId: string): Promise<void> {
    return remove(userId);
  }

  static erase(userId: string, requestedByUserId?: string): Promise<void> {
    return erase(userId, requestedByUserId);
  }

  static merge(targetUserId: string, sourceUserId: string, actorId?: string): Promise<SafeUser> {
    return merge(targetUserId, sourceUserId, actorId);
  }

  static getByEmail(email: string): Promise<User | null> {
    return getByEmail(email);
  }
}
