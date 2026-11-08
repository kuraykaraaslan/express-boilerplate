import { rateLimitBucketOf } from '@kuraykaraaslan-labs/limiter/server/limiter.ip-bucket';

/**
 * The keys of the sign-up protection (docs/phases/55-ai-firewall/02 §2.6, auth.signup-protection.ts), in a leaf file: the fake Redis of the
 * security tests runs CLEAR_MARK_SCRIPT through its JS twin (tests/security/fakes/redis.scripts.ts) and imports it from here.
 */

export const SIGNUP_MARKS = ['captcha', 'block'] as const;
export type SignupMark = (typeof SIGNUP_MARKS)[number];

/** The AI firewall's tenant opt-in for a hard block of sign-ups (owned by ai_firewall: ai_firewall.setting.keys.ts; a key, not an import). */
export const SIGNUP_HARD_BLOCK_SETTING_KEY = 'aiFirewallSignupHardBlock';

const scopeOf = (tenantId: string | null): string => (tenantId ? tenantId.toLowerCase() : 'platform');

/** The key of one mark: `auth:signup-<mark>:<tenant id | platform>:<address bucket>`. */
export const signupMarkKey = (mark: SignupMark, tenantId: string | null, address: string): string =>
  `auth:signup-${mark}:${scopeOf(tenantId)}:${rateLimitBucketOf(address)}`;

/**
 * The index of every mark (a sorted set: member = the mark's key, score = when it ends, ms). The register route reads only its last
 * entry to learn whether any mark may hold (D55-73); the marks themselves stay the plain keys above.
 */
export const SIGNUP_MARKS_INDEX_KEY = 'auth:signup-marks';

/** Deletes the key only while it still holds the run's id (one script: a later run's mark is never lifted by an earlier run's undo). */
export const CLEAR_MARK_SCRIPT = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";
