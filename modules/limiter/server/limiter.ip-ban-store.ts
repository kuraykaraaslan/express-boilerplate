/**
 * The durable copy of the address bans (docs/phases/55-ai-firewall 00 §0.2, P-2): table `security_ip_bans`
 * (entities/security_ip_ban.entity.ts, migration 001). Redis stays the hot copy the proxy reads (limiter.ban-gate.ts); this keeps
 * what must outlive a Redis flush and rebuilds the hot copy from it.
 *
 * What is persisted (`shouldPersist`): every manual and firewall ban, and an automatic ban longer than `PERSIST_MIN_SECONDS` (one
 * hour). The first automatic ban is exactly an hour; a flush that drops it costs at most that hour, while a repeat offender's longer
 * bans (doubling up to a week) and every decision a person made survive.
 *
 * Rebuild (`rebuildIfFlushed`): the marker field `hydratedAt` of `ip-bans:state` says the hot copy was built from the table. A flush
 * removes it; the next ban gate read (or the boot hook in instrumentation.ts) sees it missing and calls this, which under a short
 * Redis lock writes back every row still in force (a ban key that is still there is left alone: SET NX), re-indexes them, sets the
 * marker, and finally removes again any key whose row was lifted while it ran. Rows that ended more than `HISTORY_DAYS` ago are pruned
 * on the way.
 *
 * Installation-wide ROOT data on the default connection (the table has no tenant column and is RLS-exempt). Every function here is
 * called by the limiter only; failures are the caller's to swallow or report.
 */
import { In, IsNull, LessThan, MoreThan, Not } from 'typeorm';
import redis from '@kuraykaraaslan-labs/redis';
import { getDataSource } from '@kuraykaraaslan-labs/db';
import { SecurityIpBan, type IpBanKind, type IpBanSource } from './entities/security_ip_ban.entity';
import {
  BAN_INDEX_KEY, BAN_STATE_CIDR_PREFIX, BAN_STATE_HYDRATED_FIELD, BAN_STATE_KEY, banKey,
} from './limiter.ban-keys';
import { banKindOf } from './limiter.ban-target';
import { withinRedisBound } from './limiter.redis-bound';

/** An automatic ban is persisted only when it is longer than this, seconds (a manual or firewall ban always is). */
export const PERSIST_MIN_SECONDS = 60 * 60;
/** How long an ended or lifted ban is kept as history, days. */
export const HISTORY_DAYS = 90;
/** The most rows one rebuild writes back (the newest-ending first); a larger set is logged by the caller as a truncated rebuild. */
export const REBUILD_MAX_ROWS = 5_000;
/** The rebuild's lock and how long it may hold it, seconds. */
export const REBUILD_LOCK_KEY = 'ip-bans:rebuild-lock';
export const REBUILD_LOCK_SECONDS = 30;
/** The longest index TTL (the longest ban, limiter.ip-strikes.ts BAN_MAX_SECONDS); repeated here to avoid importing the strike store. */
const INDEX_TTL_SECONDS = 7 * 24 * 60 * 60;

/** The ban as both stores hold it (limiter.ip-strikes.ts `IpBan`). */
export type StoredBan = {
  bucket: string;
  offense: number;
  reason: string;
  bannedAt: number;
  until: number;
  manual: boolean;
  source?: IpBanSource;
};

export function shouldPersist(seconds: number, source: IpBanSource): boolean {
  return source !== 'auto' || seconds > PERSIST_MIN_SECONDS;
}

async function bans() {
  return (await getDataSource()).getRepository(SecurityIpBan);
}

/**
 * Writes one ban to the table. A newer ban on the same target replaces the older one in Redis, so the older row is marked lifted here
 * (by nobody: `liftedBy` null) and the table never holds two standing bans for one target.
 */
export async function persistBan(ban: StoredBan, source: IpBanSource, actorId: string | null): Promise<void> {
  const repo = await bans();
  const now = new Date();
  await repo.update({ target: ban.bucket, liftedAt: IsNull() }, { liftedAt: now, liftedBy: null });
  await repo.save(repo.create({
    target: ban.bucket,
    kind: banKindOf(ban.bucket) as IpBanKind,
    reason: ban.reason.slice(0, 200),
    source,
    offense: ban.offense,
    actorId,
    bannedAt: new Date(ban.bannedAt),
    expiresAt: new Date(ban.until),
    liftedAt: null,
    liftedBy: null,
  }));
}

/** Marks the standing rows of a target lifted. Returns how many there were (a ban the table knew but Redis had lost counts too). */
export async function liftPersisted(target: string, actorId: string | null): Promise<number> {
  const repo = await bans();
  const now = new Date();
  const result = await repo.update({ target, liftedAt: IsNull(), expiresAt: MoreThan(now) }, { liftedAt: now, liftedBy: actorId });
  // A row that had already ended is closed too, so it never reads as standing; it is not counted as lifted.
  await repo.update({ target, liftedAt: IsNull() }, { liftedAt: now, liftedBy: actorId });
  return Number(result?.affected ?? 0);
}

function valueOf(row: SecurityIpBan): StoredBan {
  return {
    bucket: row.target,
    offense: row.offense,
    reason: row.reason,
    bannedAt: new Date(row.bannedAt).getTime(),
    until: new Date(row.expiresAt).getTime(),
    manual: row.source === 'manual',
    source: row.source,
  };
}

export type RebuildResult = { rebuilt: boolean; restored: number; truncated: boolean };

/**
 * Writes the standing bans of the table back to Redis when the hot copy was flushed (the `hydratedAt` marker is missing). A no-op
 * when the marker is there or another process holds the rebuild lock. Throws when Redis or the database cannot be read; the marker is
 * then not set, so the next attempt tries again.
 */
export async function rebuildIfFlushed(): Promise<RebuildResult> {
  const idle: RebuildResult = { rebuilt: false, restored: 0, truncated: false };
  if (Number(await withinRedisBound(redis.hexists(BAN_STATE_KEY, BAN_STATE_HYDRATED_FIELD))) === 1) return idle;
  if ((await withinRedisBound(redis.set(REBUILD_LOCK_KEY, '1', 'EX', REBUILD_LOCK_SECONDS, 'NX'))) !== 'OK') return idle;
  try {
    const repo = await bans();
    const now = Date.now();
    const rows = await repo.find({
      where: { liftedAt: IsNull(), expiresAt: MoreThan(new Date(now)) },
      order: { expiresAt: 'DESC' },
      take: REBUILD_MAX_ROWS,
    });
    let restored = 0;
    const cidrFields: Array<string> = [];
    const indexed: Array<string | number> = [];
    for (const row of rows) {
      const ban = valueOf(row);
      const seconds = Math.ceil((ban.until - now) / 1000);
      if (seconds <= 0) continue;
      const wrote = await withinRedisBound(redis.set(banKey(ban.bucket), JSON.stringify(ban), 'EX', seconds, 'NX'));
      if (wrote === 'OK') restored += 1;
      indexed.push(ban.until, ban.bucket);
      if (banKindOf(ban.bucket) === 'cidr') cidrFields.push(`${BAN_STATE_CIDR_PREFIX}${ban.bucket}`, String(ban.until));
    }
    if (indexed.length > 0) {
      await withinRedisBound(redis.zadd(BAN_INDEX_KEY, ...indexed));
      await withinRedisBound(redis.expire(BAN_INDEX_KEY, INDEX_TTL_SECONDS));
    }
    await withinRedisBound(redis.hset(BAN_STATE_KEY, ...cidrFields, BAN_STATE_HYDRATED_FIELD, String(now)));

    // A lift that ran between the read above and the writes: its row is lifted now, so its key goes again.
    const ids = rows.map((r) => r.banId);
    if (ids.length > 0) {
      const lifted = await repo.find({ where: { banId: In(ids), liftedAt: Not(IsNull()) } });
      for (const row of lifted) {
        const standing = await repo.findOne({ where: { target: row.target, liftedAt: IsNull(), expiresAt: MoreThan(new Date()) } });
        if (standing) continue;
        await withinRedisBound(redis.del(banKey(row.target)));
        await withinRedisBound(redis.zrem(BAN_INDEX_KEY, row.target));
        await withinRedisBound(redis.hdel(BAN_STATE_KEY, `${BAN_STATE_CIDR_PREFIX}${row.target}`));
      }
    }

    await repo.delete({ expiresAt: LessThan(new Date(now - HISTORY_DAYS * 24 * 60 * 60 * 1000)) }).catch(() => undefined);
    return { rebuilt: true, restored, truncated: rows.length >= REBUILD_MAX_ROWS };
  } finally {
    await withinRedisBound(redis.del(REBUILD_LOCK_KEY)).catch(() => 0);
  }
}
