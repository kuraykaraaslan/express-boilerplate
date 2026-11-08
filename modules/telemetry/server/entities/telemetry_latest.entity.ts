import 'reflect-metadata';
import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * The latest value of each key of each entity (docs/phases/42-telemetry/00 §0.3, ED-10): keyed `(tenantId, entityId, keyId)` with
 * the kind's id (`kindId`, `telemetry_kinds`) beside it, upserted by the writer only for a strictly newer `ts` (history, latest and
 * the live view keep the first value at an equal ts). Exactly one of `numVal` (a number) and `other` (any other value, as JSON) is
 * set. Created by migration 001, the kind column by 002 (`synchronize: false`).
 */
@Entity({ name: 'telemetry_latest', synchronize: false })
export class TelemetryLatest {
  @PrimaryColumn({ type: 'uuid' })
  tenantId!: string;

  @PrimaryColumn({ type: 'uuid' })
  entityId!: string;

  @PrimaryColumn({ type: 'int' })
  keyId!: number;

  /** The kind the entity belongs to (`telemetry_kinds.kindId`); a plain column, in no key. */
  @Column({ type: 'smallint' })
  kindId!: number;

  @Column({ type: 'timestamptz' })
  ts!: Date;

  @Column({ type: 'double precision', nullable: true })
  numVal!: number | null;

  @Column({ type: 'jsonb', nullable: true })
  other!: unknown;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;
}
