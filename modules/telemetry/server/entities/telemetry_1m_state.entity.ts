import 'reflect-metadata';
import { Column, Entity, PrimaryColumn } from 'typeorm';

/** The minute job's watermark per tenant and retention class (`telemetry.minute-rollup.ts`): every minute before it is aggregated. */
@Entity({ name: 'telemetry_1m_state', synchronize: false })
export class Telemetry1mState {
  @PrimaryColumn({ type: 'uuid' })
  tenantId!: string;

  @PrimaryColumn({ type: 'int' })
  classDays!: number;

  @Column({ type: 'timestamptz' })
  watermark!: Date;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;
}
