import { userKeys } from '@kuraykaraaslan-labs/db/server/db.user-keys.service';

/**
 * The OAuth tokens of a linked identity at rest (decision F27; declared in user_social_account.tenant-key-columns.ts): sealed under the row USER's
 * per-user data key and opened only in that user's context (db.user-keys.service.ts). A token is the person's, not a workspace's: erasing the person
 * destroys the key and every copy of the token, backups included when the node's provider keeps its slots outside the database.
 *
 * Dual read: a token written before F27 (a v1 or node-key envelope, or a legacy plaintext) still opens; the next write, or the online backfill,
 * moves it under the user's key. A token under another user's key, or under a destroyed key, reads as null (counted): the caller treats it as
 * absent (re-authorisation), never as another person's token.
 */
export async function sealToken<T extends string | null | undefined>(userId: string, token: T): Promise<T | string> {
  return token ? userKeys.encryptOpt(userId, token) : token;
}

export async function openToken(userId: string, stored: string | null | undefined): Promise<string | null> {
  if (!stored) return null;
  return (await userKeys.decryptOpt(userId, stored)) ?? null;
}
