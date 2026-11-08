import 'reflect-metadata';
import { Column, Entity, PrimaryColumn } from 'typeorm';

/** The `otel` lane's copy of `telemetry_1m_state` (04 §4.2, ED-9; migration 003): same columns, the lane's own rows. */
@Entity({ name: 'telemetry_otel_1m_state', synchronize: false })
export class TelemetryOtel1mState {
  @PrimaryColumn({ type: 'uuid' })
  tenantId!: string;

  @PrimaryColumn({ type: 'int' })
  classDays!: number;

  @Column({ type: 'timestamptz' })
  watermark!: Date;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;
}
