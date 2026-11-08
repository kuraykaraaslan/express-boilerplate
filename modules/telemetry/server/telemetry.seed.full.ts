import 'reflect-metadata';
import type { ObjectLiteral } from 'typeorm';
import type { SeedContext } from '@kuraykaraaslan-labs/db/server/db.seed-contracts';
import { TelemetryKey } from './entities/telemetry_key.entity';
import { TelemetryLatest } from './entities/telemetry_latest.entity';
import { TelemetryClassBinding } from './entities/telemetry_class_binding.entity';
import { Telemetry1mState } from './entities/telemetry_1m_state.entity';
import { Telemetry1mDirty } from './entities/telemetry_1m_dirty.entity';
import { TelemetryMsgR7 } from './entities/telemetry_msg_r7.entity';
import { TelemetryMsgR30 } from './entities/telemetry_msg_r30.entity';
import { TelemetryMsgR90 } from './entities/telemetry_msg_r90.entity';
import { TelemetryMsgR365 } from './entities/telemetry_msg_r365.entity';
import { TelemetryMsgR1095 } from './entities/telemetry_msg_r1095.entity';
import { Telemetry1mR7 } from './entities/telemetry_1m_r7.entity';
import { Telemetry1mR30 } from './entities/telemetry_1m_r30.entity';
import { Telemetry1mR90 } from './entities/telemetry_1m_r90.entity';
import { Telemetry1mR365 } from './entities/telemetry_1m_r365.entity';
import { Telemetry1mR1095 } from './entities/telemetry_1m_r1095.entity';
import { TelemetryKind } from './entities/telemetry_kind.entity';

/**
 * Full-load seed for the Core telemetry store (the guarded test database only). The module is exempt from the default seed as
 * `runtime-state` (ADR-0018): readings are written by their producers, and seeded rows would be fabricated measurements. The
 * full-load lane still fills every table, so a schema or RLS regression on one of them shows up there.
 *
 * `seedTelemetryRows` fills the tables for one entity of one kind: two keys, a fixed timestamp well in the past (so no retention or
 * rollup decision of a real run depends on them), three raw messages and one minute row per retention class, the latest value per
 * key, one minute-job watermark per class and one dirty range. Idempotent: every insert ignores a row that is already there (the
 * tables' own primary and unique keys). A module that owns a kind (iot_telemetry for devices) calls it for one of its seeded
 * entities; `seedTelemetryFull` calls it for a synthetic entity of the inert kind `telemetry.seed`, so a build without such a
 * module fills the tables too.
 *
 * The tables are created by migrations only (TimescaleDB, `synchronize: false`): on a database without them (sync mode, no
 * TimescaleDB) there is nothing to fill and the seeder does nothing.
 */
const ANCHOR = Date.UTC(2026, 5, 1, 9, 0, 0);
const MINUTE = 60_000;
const CLASSES = [7, 30, 90, 365, 1095] as const;
const RAW = { 7: TelemetryMsgR7, 30: TelemetryMsgR30, 90: TelemetryMsgR90, 365: TelemetryMsgR365, 1095: TelemetryMsgR1095 } as const;
const ROLLUP = { 7: Telemetry1mR7, 30: Telemetry1mR30, 90: Telemetry1mR90, 365: Telemetry1mR365, 1095: Telemetry1mR1095 } as const;

/** A stable bigint (as a string, the column's TypeORM type) from a name: the message hash of a synthetic message. */
// FNV-1a, kept positive in 62 bits; BigInt() calls, not literals (the compile target is below ES2020)
const FNV_OFFSET = BigInt('1469598103934665603');
const FNV_PRIME = BigInt('1099511628211');
const MASK_62 = BigInt('0x3fffffffffffffff');
const hashOf = (name: string): string => {
  let h = FNV_OFFSET;
  for (const ch of name) h = ((h ^ BigInt(ch.codePointAt(0)!)) * FNV_PRIME) & MASK_62;
  return h.toString();
};

export const SEED_KIND = 'telemetry.seed';
export const SEED_ENTITY_ID = '00000000-0000-4000-8000-00000000c0de';

export async function seedTelemetryRows(ctx: SeedContext, { kind, entityId }: { kind: string; entityId: string }): Promise<void> {
  if (!ctx.fullLoad) return;
  const [{ t } = { t: null }] = await ctx.ds.query(`SELECT to_regclass('telemetry_msg_r7') AS t`) as Array<{ t: string | null }>;
  if (!t) return;

  const tenantId = ctx.tenantId;
  const insert = async <T extends ObjectLiteral>(entity: new () => T, rows: Array<Partial<T>>) => {
    if (rows.length) await ctx.repo(entity).createQueryBuilder().insert().values(rows as never).orIgnore().execute();
  };

  await insert(TelemetryKey, [{ tenantId, key: 'temperature' }, { tenantId, key: 'humidity' }] as Array<Partial<TelemetryKey>>);
  const keys = await ctx.repo(TelemetryKey).find({ where: { tenantId } });
  const keyId = (k: string) => keys.find((r) => r.key === k)?.keyId;
  const temperature = keyId('temperature');
  const humidity = keyId('humidity');
  if (temperature === undefined || humidity === undefined) return;
  // the kind's id (ED-10): a migration may have registered the kind already; either way the database answers its own id
  await insert(TelemetryKind, [{ kind }] as Array<Partial<TelemetryKind>>);
  const kindId = (await ctx.repo(TelemetryKind).find({ where: { kind } }))[0]?.kindId;
  if (kindId === undefined) return;

  await insert(TelemetryClassBinding, [{ tenantId, entityType: kind, validFrom: new Date(ANCHOR - 30 * 24 * 60 * MINUTE), classDays: 30, validTo: null }]);

  const minute = new Date(ANCHOR);
  for (const days of CLASSES) {
    await insert(RAW[days] as new () => ObjectLiteral, [0, 1, 2].map((i) => ({
      tenantId, entityId, ts: new Date(ANCHOR + i * 10_000), msgHash: hashOf(`seed:${days}:${i}`), kindId,
      numKeyIds: [temperature, humidity], numVals: [20 + i, 40 + i], other: i === 2 ? { status: 'ok' } : null,
    })));
    await insert(ROLLUP[days] as new () => ObjectLiteral, [
      { tenantId, entityId, keyId: temperature, ts: minute, kindId, sum: 63, count: '3', min: 20, max: 22, last: 22 },
      { tenantId, entityId, keyId: humidity, ts: minute, kindId, sum: 123, count: '3', min: 40, max: 42, last: 42 },
    ]);
    await insert(Telemetry1mState, [{ tenantId, classDays: days, watermark: minute }]);
  }

  await insert(TelemetryLatest, [
    { tenantId, entityId, keyId: temperature, kindId, ts: new Date(ANCHOR + 20_000), numVal: 22, other: null },
    { tenantId, entityId, keyId: humidity, kindId, ts: new Date(ANCHOR + 20_000), numVal: 42, other: null },
  ]);
  if ((await ctx.repo(Telemetry1mDirty).count({ where: { tenantId } })) === 0) {
    await insert(Telemetry1mDirty, [{ tenantId, classDays: 30, dirtyFrom: minute, dirtyTo: new Date(ANCHOR + MINUTE) }]);
  }
}

export async function seedTelemetryFull(ctx: SeedContext): Promise<void> {
  await seedTelemetryRows(ctx, { kind: SEED_KIND, entityId: SEED_ENTITY_ID });
}
