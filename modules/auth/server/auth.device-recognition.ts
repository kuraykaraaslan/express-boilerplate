import { getDataSource } from '@kuraykaraaslan-labs/db';
import Logger from '@kuraykaraaslan-labs/logger';
import { UserSession } from '@kuraykaraaslan-labs/user_session/server/entities/user_session.entity';

/**
 * Was this sign-in from somewhere this person has signed in from before?
 *
 * ### Why this exists
 *
 * The login route already mails "a new sign-in to your account was detected" —
 * on EVERY sign-in. A security alert that arrives every single time is one
 * people learn to delete without reading, which means the one that actually
 * matters gets deleted too. The backlog item asks for the alert on a NEW device
 * or location, and that is the whole difference between a signal and noise.
 *
 * ### No new table
 *
 * `user_sessions` already carries `deviceFingerprint`, `userAgent` and
 * `ipAddress` for every session this user has ever had. "Have they been here
 * before" is a question those rows already answer, and a `known_devices` table
 * would be a second, drifting record of the same fact.
 *
 * ### What counts as known, and which way it errs
 *
 * A fingerprint match is the strong signal. Failing that, the same user-agent
 * from the same IP is treated as known — a returning laptop on the same
 * connection. A DIFFERENT IP with the same user-agent is NOT known: that is
 * exactly the "signed in from a new location" case worth mailing about, and a
 * mobile network changing address means an occasional extra alert, which is the
 * right direction to be wrong in.
 *
 * When the lookup fails, the sign-in is treated as NEW. An alert nobody needed
 * is a nuisance; a missed alert is the thing the feature exists to prevent.
 */

export interface DeviceSignature {
  deviceFingerprint?: string | null;
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface RecognitionResult {
  known: boolean;
  /** Why — useful in the log when somebody asks why they were or were not mailed. */
  reason: 'fingerprint' | 'agent_and_ip' | 'first_session' | 'new' | 'lookup_failed';
}

export default class DeviceRecognitionService {
  /**
   * Whether this user has been seen from this device/location before.
   *
   * `excludeSessionId` skips the session being created right now — without it
   * every login recognises itself and no alert is ever sent.
   */
  static async recognise(
    userId: string,
    signature: DeviceSignature,
    opts: { excludeSessionId?: string } = {},
  ): Promise<RecognitionResult> {
    try {
      const ds = await getDataSource();
      const sessions = await ds.getRepository(UserSession).find({
        where: { userId },
        order: { createdAt: 'DESC' },
        // Enough history to recognise a device somebody uses occasionally,
        // bounded so a user with thousands of sessions does not scan them all.
        take: 200,
      });

      const others = sessions.filter((s) => s.userSessionId !== opts.excludeSessionId);
      // A user with no prior session cannot have a "new device" — this is their
      // first, and telling somebody their brand-new account was signed into is
      // noise on the one occasion they already know about.
      if (others.length === 0) return { known: true, reason: 'first_session' };

      const fingerprint = signature.deviceFingerprint?.trim();
      if (fingerprint && others.some((s) => s.deviceFingerprint === fingerprint)) {
        return { known: true, reason: 'fingerprint' };
      }

      const agent = signature.userAgent?.trim();
      const ip = signature.ipAddress?.trim();
      if (agent && ip && others.some((s) => s.userAgent === agent && s.ipAddress === ip)) {
        return { known: true, reason: 'agent_and_ip' };
      }

      return { known: false, reason: 'new' };
    } catch (error) {
      // Err towards alerting: a nuisance mail beats a missed one.
      Logger.warn(`[auth.device-recognition][user:${userId}] ${error}`);
      return { known: false, reason: 'lookup_failed' };
    }
  }
}
