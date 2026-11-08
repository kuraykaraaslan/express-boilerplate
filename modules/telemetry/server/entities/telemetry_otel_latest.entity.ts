import 'reflect-metadata';
import { Column, Entity, PrimaryColumn } from 'typeorm';

/** The `otel` lane's copy of `telemetry_latest` (04 §4.2, ED-9; migration 003): same columns, the lane's own rows. */
@Entity({ name: 'telemetry_otel_latest', synchronize: false })
export class TelemetryOtelLatest {
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
