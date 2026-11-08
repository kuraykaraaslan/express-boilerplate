import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import type { FindOptionsWhere } from 'typeorm';
import type { SeedContext } from '@kuraykaraaslan-labs/db/server/db.seed-contracts';
import { SEED_USER_ID, SEED_ADMIN_USER_ID } from '@kuraykaraaslan-labs/db/server/db.seed-contracts';
import { UserSession } from './entities/user_session.entity';

/**
 * Seed for the `user_session` module.
 *
 * Rules of the house (mirrors store.seed.ts):
 *  - Always go through `ctx.foc(repo, where, create)` with a natural key in
 *    `where` so re-runs reuse rows. `UserSession` has no @Unique constraint, but
 *    `accessToken` is an indexed token that is unique per session in practice —
 *    we use it as the natural key.
 *  - Use *valid* enum values: `sessionStatus` is one of ACTIVE / EXPIRED /
 *    REVOKED (see user_session.enums.ts). Never invent another status.
 *  - `UserSession` rows live in the system/global store (a user can hold one
 *    per tenant membership) — use `ctx.systemRepo<UserSession>(UserSession)`,
 *    but every row now carries a real `tenantId` (device bearer work): use
 *    `ctx.tenantId`, the tenant this seed run is for.
 *  - Timestamps are real Date objects (this runs under tsx / Node).
 */
export async function seedUserSession(ctx: SeedContext): Promise<void> {
  const { foc, refs, tenantId } = ctx;
  const repo = ctx.systemRepo<UserSession>(UserSession);

  // Cross-module user ids: prefer published refs, fall back to the shared
  // deterministic seed constants (the session DB has no FK to the user table).
  const userId = (refs.userId as string) ?? SEED_USER_ID;
  const adminUserId = (refs.adminUserId as string) ?? SEED_ADMIN_USER_ID;

  const now = new Date();
  const oneHour = 60 * 60 * 1000;
  const oneDay = 24 * oneHour;

  // Concrete local def type so foc's DeepPartial inference stays intact
  // (do NOT spread a Partial<UserSession> into the create arg).
  type SessionDef = {
    userId: string;
    tenantId: string;
    accessToken: string;
    refreshToken: string;
    deviceFingerprint?: string;
    userAgent?: string;
    ipAddress?: string;
    sessionStatus: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
    otpVerifyNeeded: boolean;
    sessionExpiry: Date;
    metadata?: unknown;
    createdAt: Date;
  };

  const defs: SessionDef[] = [
    // Active web session for the regular user — valid for another day.
    {
      userId,
      tenantId,
      accessToken: 'seed-access-token-user-web-active',
      refreshToken: 'seed-refresh-token-user-web-active',
      deviceFingerprint: 'fp-chrome-macos-001',
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      ipAddress: '203.0.113.10',
      sessionStatus: 'ACTIVE',
      otpVerifyNeeded: false,
      sessionExpiry: new Date(now.getTime() + oneDay),
      metadata: { client: 'web', platform: 'macos' },
      createdAt: new Date(now.getTime() - 2 * oneHour),
    },
    // Active device-bearer session (phone) for the regular user that still needs OTP verification.
    {
      userId,
      tenantId,
      accessToken: 'seed-access-token-user-device-otp',
      refreshToken: 'seed-refresh-token-user-device-otp',
      deviceFingerprint: 'fp-ios-iphone-002',
      userAgent: 'BoilerplateApp/2.3 (iPhone; iOS 17.4; Scale/3.00)',
      ipAddress: '198.51.100.42',
      sessionStatus: 'ACTIVE',
      otpVerifyNeeded: true,
      sessionExpiry: new Date(now.getTime() + 7 * oneDay),
      metadata: { device: { type: 'phone', brand: 'Apple', model: 'iPhone 15 Pro', os: 'iOS', osVersion: '17.4', appVersion: '2.3' } },
      createdAt: new Date(now.getTime() - 30 * 60 * 1000),
    },
    // Expired session for the admin user (history / cleanup target).
    {
      userId: adminUserId,
      tenantId,
      accessToken: 'seed-access-token-admin-expired',
      refreshToken: 'seed-refresh-token-admin-expired',
      deviceFingerprint: 'fp-firefox-linux-003',
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0',
      ipAddress: '192.0.2.77',
      sessionStatus: 'EXPIRED',
      otpVerifyNeeded: false,
      sessionExpiry: new Date(now.getTime() - 3 * oneDay),
      metadata: { client: 'web', platform: 'linux' },
      createdAt: new Date(now.getTime() - 10 * oneDay),
    },
    // Revoked session for the admin user (e.g. signed out from another device).
    {
      userId: adminUserId,
      tenantId,
      accessToken: 'seed-access-token-admin-revoked',
      refreshToken: 'seed-refresh-token-admin-revoked',
      deviceFingerprint: 'fp-edge-windows-004',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 Edg/124.0',
      ipAddress: '203.0.113.200',
      sessionStatus: 'REVOKED',
      otpVerifyNeeded: false,
      sessionExpiry: new Date(now.getTime() + 2 * oneDay),
      metadata: { client: 'web', platform: 'windows', revokedReason: 'manual_signout' },
      createdAt: new Date(now.getTime() - oneDay),
    },
  ];

  let firstSessionId: string | undefined;
  for (const def of defs) {
    const session = await foc(
      repo,
      { accessToken: def.accessToken } as FindOptionsWhere<UserSession>,
      def,
    );
    firstSessionId ??= session.userSessionId;
  }

  // Publish a reference later modules (e.g. impersonation, audit) might consume.
  refs.userSessionId = firstSessionId;

  ctx.log(`user_session: 4 sessions (active/expired/revoked) for users ${userId}, ${adminUserId}`);
}

// ── Filler: session history for the user base ──────────────────────────────

/** The filler user pool of `user_filler` for this tenant, in index order (found by the `.seed-<tail>@example.com` email suffix). */
async function fillerUsers(ctx: SeedContext): Promise<Array<{ userId: string; email: string; i: number }>> {
  const tail = ctx.tenantId.replace(/-/g, '').slice(-8);
  const rows = (await ctx.systemDs.query(`SELECT "userId", email FROM users WHERE email LIKE $1 ORDER BY email`, [`%.seed-${tail}@example.com`])) as Array<{ userId: string; email: string }>;
  return rows
    .map((r) => ({ ...r, i: Number(/\.(\d{3})\.seed-/.exec(r.email)?.[1] ?? 0) - 1 }))
    .sort((a, b) => a.i - b.i);
}

/**
 * Filler for `user_session`: two to three sessions per `user_filler` user (demo: ~100), mostly expired
 * or revoked history with some active ones, across devices and agents. Registered as its own seeder
 * (`user_session_filler`).
 *
 * Demo-safe: the token columns hold random bytes generated here and never shown anywhere, so no
 * session can be presented by anyone. Idempotent: keyed on (user, tenant, deviceFingerprint), where the
 * fingerprint is built from the user index and the session ordinal.
 */
export async function seedUserSessionFiller(ctx: SeedContext): Promise<void> {
  const { foc, faker, tenantId } = ctx;
  const repo = ctx.systemRepo<UserSession>(UserSession);
  const agents = [
    { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', meta: { client: 'web', platform: 'windows' } },
    { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15', meta: { client: 'web', platform: 'macos' } },
    { ua: 'BoilerplateApp/2.3 (iPhone; iOS 17.4; Scale/3.00)', meta: { client: 'mobile', platform: 'ios' } },
    { ua: 'BoilerplateApp/2.3 (Android 14; Pixel 8)', meta: { client: 'mobile', platform: 'android' } },
  ];
  const tail = tenantId.replace(/-/g, '').slice(-8);
  let n = 0;
  for (const u of await fillerUsers(ctx)) {
    const sessions = 2 + (u.i % 2);
    for (let k = 0; k < sessions; k++) {
      const deviceFingerprint = `seed-fp-${tail}-${u.i + 1}-${k + 1}`;
      const agent = agents[(u.i + k) % agents.length];
      const createdAt = faker.pastDate(120);
      const status = k === 0 && u.i % 3 === 0 ? 'ACTIVE' : k % 2 ? 'REVOKED' : 'EXPIRED';
      await foc(repo, { userId: u.userId, tenantId, deviceFingerprint } as FindOptionsWhere<UserSession>, {
        userId: u.userId, tenantId, accessToken: randomBytes(32).toString('base64url'), refreshToken: randomBytes(32).toString('base64url'),
        deviceFingerprint, userAgent: agent.ua, ipAddress: `198.51.100.${(u.i * 3 + k) % 250 + 1}`, sessionStatus: status,
        otpVerifyNeeded: u.i % 9 === 0 && k === 0,
        sessionExpiry: status === 'ACTIVE' ? new Date(Date.UTC(2027, 0, 1)) : new Date(createdAt.getTime() + 7 * 86_400_000),
        metadata: agent.meta, createdAt,
      });
      n++;
    }
  }
  ctx.log(`user_session(filler): ${n} sessions for ${tenantId}`);
}
