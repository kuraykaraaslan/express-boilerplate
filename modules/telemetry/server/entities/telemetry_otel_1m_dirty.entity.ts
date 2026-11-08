import 'reflect-metadata';
import { Column, Entity, PrimaryColumn } from 'typeorm';

/** The `otel` lane's copy of `telemetry_1m_dirty` (04 §4.2, ED-9; migration 003): same columns, the lane's own rows. */
@Entity({ name: 'telemetry_otel_1m_dirty', synchronize: false })
export class TelemetryOtel1mDirty {
  @PrimaryColumn({ type: 'uuid' })
  tenantId!: string;

  @PrimaryColumn({ type: 'uuid', default: () => 'gen_random_uuid()' })
  id!: string;

  @Column({ type: 'int' })
  classDays!: number;

  @Column({ type: 'timestamptz' })
  dirtyFrom!: Date;

  @Column({ type: 'timestamptz' })
  dirtyTo!: Date;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;
}
