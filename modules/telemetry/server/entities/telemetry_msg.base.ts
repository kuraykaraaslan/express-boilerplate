import 'reflect-metadata';
import { Column, PrimaryColumn } from 'typeorm';

/**
 * The columns of every raw message table `telemetry_msg_r{d}` (00 P0-T-20, OD-144): one row per device message, numeric values by key
 * id in `numKeyIds` / `numVals` (same order and length), every other value under its key name in `other`. The class entities
 * (`telemetry_msg_r{d}.entity.ts`) extend it with `synchronize: false`: migration 001 creates the tables and db's time-series deploy
 * phase makes them hypertables, so TypeORM must never "fix" one. Code reads and writes them only through the access view
 * (`timeSeriesAccessRel`, 01 P0-T-11), never through a repository; the entities exist for the registry and the RLS coverage.
 */
export abstract class TelemetryMsgRow {
  @PrimaryColumn({ type: 'uuid' })
  tenantId!: string;

  /** D-7: the entity the record belongs to (a device in P1); a bare uuid, no foreign key on a hypertable. */
  @PrimaryColumn({ type: 'uuid' })
  entityId!: string;

  @PrimaryColumn({ type: 'timestamptz' })
  ts!: Date;

  /** First 8 bytes of SHA-1 over the canonical values, as a signed int8 (`telemetry.hash.ts`). */
  @PrimaryColumn({ type: 'bigint' })
  msgHash!: string;

  /** The kind the entity belongs to (`telemetry_kinds.kindId`, ED-10): a plain column, in no key and no index. Migration 002. */
  @Column({ type: 'smallint' })
  kindId!: number;

  @Column({ type: 'int', array: true, default: () => "'{}'" })
  numKeyIds!: number[];

  @Column({ type: 'double precision', array: true, default: () => "'{}'" })
  numVals!: number[];

  @Column({ type: 'jsonb', nullable: true })
  other!: Record<string, unknown> | null;
}
