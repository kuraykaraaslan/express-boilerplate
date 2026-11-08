import 'reflect-metadata';
import type { FindOptionsWhere } from 'typeorm';
import type { SeedContext } from '@kuraykaraaslan-labs/db/server/db.seed-contracts';
import { SEED_USER_ID, SEED_ADMIN_USER_ID, fictionalPhone } from '@kuraykaraaslan-labs/db/server/db.seed-contracts';
import { User } from './entities/user.entity';

/**
 * Demo seed for the `user` module.
 *
 * Rules of the house (mirrors `store.seed.ts`):
 *  - Always go through `ctx.foc(repo, where, create)` with a natural key in
 *    `where`. The `User` entity's only @Unique constraint is `email`, so that
 *    is the idempotency key — re-runs reuse the existing row.
 *  - The `User` entity has NO `tenantId` column, so it is system-scoped:
 *    we use `ctx.systemRepo<User>(User)` and never set a tenantId.
 *  - Use *valid* enum values only (see `user.enums.ts`):
 *      userRole   ∈ { USER, ADMIN }
 *      userStatus ∈ { ACTIVE, INACTIVE, SUSPENDED }
 *  - Emails are stored lower-cased (the service normalises with toLowerCase);
 *    we seed them lower-cased so cache keys and lookups line up.
 *  - `password` is a real bcrypt hash literal (10 rounds) — every seeded user
 *    can log in with the passphrase "password". We avoid hashing at seed time
 *    to keep this file dependency-free.
 *  - Timestamp columns get real `Date` objects (this runs under tsx/Node).
 *  - We pin the canonical demo user / admin to the shared deterministic ids so
 *    cross-module references (orders, reviews, …) stay stable across re-runs.
 */

// bcrypt hash of the string "password" at cost factor 10 — valid & verifiable.
const DEMO_PASSWORD_HASH = '$2b$10$EJP5XhiqI0bi.RVdM7wTx.tvdsjPjJIzQjK.dLVfOl4GpGunXND9S';

type UserDef = {
  userId: string;
  email: string;
  phone?: string;
  userRole: 'USER' | 'ADMIN';
  userStatus: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  /** days before "now" the account was created */
  createdDaysAgo: number;
  /** whether the email has been verified (and, if so, roughly when) */
  verified: boolean;
};

export async function seedUser(ctx: SeedContext): Promise<void> {
  const { foc, refs } = ctx;
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const userRepo = ctx.systemRepo<User>(User);

  // Three varied accounts: a verified standard member, a verified admin, and a
  // suspended/unverified account — exercising every role + status value.
  const userDefs: UserDef[] = [
    {
      userId: SEED_USER_ID,
      email: 'demo.user@example.com',
      phone: '+1-202-555-0101',
      userRole: 'USER',
      userStatus: 'ACTIVE',
      createdDaysAgo: 30,
      verified: true,
    },
    {
      userId: SEED_ADMIN_USER_ID,
      email: 'demo.admin@example.com',
      phone: '+44-20-7946-0991',
      userRole: 'ADMIN',
      userStatus: 'ACTIVE',
      createdDaysAgo: 90,
      verified: true,
    },
    {
      userId: 'a0000000-0000-4000-8000-000000000003',
      email: 'demo.suspended@example.com',
      userRole: 'USER',
      userStatus: 'SUSPENDED',
      createdDaysAgo: 7,
      verified: false,
    },
  ];

  for (const def of userDefs) {
    const createdAt = new Date(now - def.createdDaysAgo * day);
    await foc(userRepo,
      { email: def.email } as FindOptionsWhere<User>,
      {
        userId: def.userId,
        email: def.email,
        phone: def.phone,
        password: DEMO_PASSWORD_HASH,
        userRole: def.userRole,
        userStatus: def.userStatus,
        // verify shortly after creation; leave unverified accounts null.
        emailVerifiedAt: def.verified ? new Date(createdAt.getTime() + day) : undefined,
        createdAt,
        updatedAt: createdAt,
      },
    );
  }

  // ── Publish references later modules consume ───────────────────────────────
  refs.userId = SEED_USER_ID;
  refs.adminUserId = SEED_ADMIN_USER_ID;

  ctx.log('user: 3 users (USER/ADMIN, ACTIVE/SUSPENDED) seeded (system-scoped)');
}

// ── Filler: a realistic user base (profile-scaled) ────────────────────────────

const FILLER_FIRST = ['Ada', 'Bora', 'Cem', 'Deniz', 'Elif', 'Furkan', 'Gizem', 'Hakan', 'Irmak', 'Jale', 'Kerem', 'Lale', 'Mert', 'Nehir', 'Onur', 'Pelin', 'Rana', 'Selin', 'Tolga', 'Umut', 'Volkan', 'Yasemin', 'Zeynep', 'Alice', 'Ben', 'Clara', 'Daniel', 'Emma', 'Felix', 'Grace'];
const FILLER_LAST = ['Aksoy', 'Bulut', 'Coskun', 'Dogan', 'Erdem', 'Gunes', 'Kurt', 'Ozkan', 'Polat', 'Sahin', 'Tekin', 'Yalcin', 'Baker', 'Carter', 'Evans', 'Foster', 'Hughes', 'Morgan', 'Parker', 'Reed'];

/** Deterministic name of filler user `i` (index arithmetic, not a faker draw, so it can key the row). */
export function fillerUserName(i: number): { firstName: string; lastName: string } {
  return { firstName: FILLER_FIRST[i % FILLER_FIRST.length], lastName: FILLER_LAST[(i * 7 + Math.floor(i / FILLER_FIRST.length)) % FILLER_LAST.length] };
}

/** Email of filler user `i` for a tenant: unique per (tenant, index), reserved domain. Other seeders find the pool by the `.seed-<tail>@` part. */
export function fillerUserEmail(tenantId: string, i: number): string {
  const { firstName, lastName } = fillerUserName(i);
  const tail = tenantId.replace(/-/g, '').slice(-8);
  return `${firstName}.${lastName}.${String(i + 1).padStart(3, '0')}.seed-${tail}@example.com`.toLowerCase();
}

/**
 * Filler for `user`: a user base of dozens of accounts per seeded tenant (demo: 40), so member,
 * session and profile screens have something to page through. Registered as its own seeder
 * (`user_filler`) with its own faker stream: the hand-authored users above are untouched.
 *
 * Demo-safe: role USER only (never a platform ADMIN), emails on example.com, the same demo password
 * hash as the base users. Statuses spread over ACTIVE / INACTIVE / SUSPENDED, verified and not.
 * Idempotent: keyed on the email, which is built from the index and the tenant id tail.
 */
export async function seedUserFiller(ctx: SeedContext): Promise<void> {
  const { foc, faker } = ctx;
  const repo = ctx.systemRepo<User>(User);
  const n = Math.min(ctx.count(8), 400);
  const statuses: Array<'ACTIVE' | 'INACTIVE' | 'SUSPENDED'> = ['ACTIVE', 'ACTIVE', 'ACTIVE', 'ACTIVE', 'ACTIVE', 'ACTIVE', 'ACTIVE', 'INACTIVE', 'ACTIVE', 'SUSPENDED'];
  const countries = ['TR', 'US', 'DE', 'GB', 'FR', 'NL'];
  for (let i = 0; i < n; i++) {
    const email = fillerUserEmail(ctx.tenantId, i);
    const createdAt = faker.pastDate(365);
    const verified = i % 6 !== 5;
    await foc(repo, { email } as FindOptionsWhere<User>, {
      email,
      phone: i % 3 === 0 ? fictionalPhone(3200 + i) : undefined,
      password: DEMO_PASSWORD_HASH,
      userRole: 'USER',
      userStatus: statuses[i % statuses.length],
      emailVerifiedAt: verified ? new Date(createdAt.getTime() + faker.int(1, 72) * 3600_000) : undefined,
      country: countries[i % countries.length],
      createdAt,
      updatedAt: createdAt,
    });
  }
  ctx.log(`user(filler): ${n} USER accounts for tenant ${ctx.tenantId}`);
}
