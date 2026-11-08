/**
 * Every cache entry of a user's sessions lives under `session:<userId>:`, so a revocation can find them all:
 *   session:<userId>:<sha256 of the access token>  the session (SafeUserSession), written by getSession
 *   session:<userId>:user                           the user (SafeUser), written by getSessionWithUser
 * A token hash is hex, so it can never be the literal `user`.
 */
export const sessionCacheKey = (userId: string, hashedAccessToken: string) => `session:${userId}:${hashedAccessToken}`;
export const userCacheKey = (userId: string) => `session:${userId}:user`;
