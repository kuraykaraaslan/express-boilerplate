import 'reflect-metadata';
import { Column, PrimaryColumn } from 'typeorm';

/**
 * The columns of every 1-minute table `telemetry_1m_r{d}` (00 P0-T-07b): sum, count, min, max and last of one numeric key of one entity
 * in one UTC minute, filled by the lane's minute job (`telemetry.minute-rollup.ts`) from the raw rows; db derives the hour
 * and day rollups from it. `synchronize: false` on every class entity, as for the raw tables.
 */
export abstract class Telemetry1mRow {
  @PrimaryColumn({ type: 'uuid' })
  tenantId!: string;

  @PrimaryColumn({ type: 'uuid' })
  entityId!: string;

  @PrimaryColumn({ type: 'int' })
  keyId!: number;

  /** The start of the minute (UTC). */
  @PrimaryColumn({ type: 'timestamptz' })
  ts!: Date;

  /** The kind of the entity (`telemetry_kinds.kindId`, ED-10), carried from the raw rows; a plain column. */
  @Column({ type: 'smallint' })
  kindId!: number;

  @Column({ type: 'double precision' })
  sum!: number;

  @Column({ type: 'bigint' })
  count!: string;

  @Column({ type: 'double precision' })
  min!: number;

  @Column({ type: 'double precision' })
  max!: number;

  @Column({ type: 'double precision' })
  last!: number;
}
