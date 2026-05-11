import { SafeUser } from '@/modules/user/user.types';
import { SafeUserSession } from '@/modules/user_session/user_session.types';

export type { SafeUser, SafeUserSession };

export interface TokenPayload {
  userId: string;
  userSessionId: string;
  deviceFingerprint?: string;
}
