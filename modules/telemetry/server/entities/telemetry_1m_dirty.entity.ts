import 'reflect-metadata';
import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * A dirty-minute hint (02 P0-T-08b): the writer inserts one, in the transaction of the rows, when it stores rows of a minute the job
 * may already have aggregated (a late or replayed record); the minute job recomputes those minutes and deletes the hint. A hint
 * committed with its rows cannot be lost.
 */
@Entity({ name: 'telemetry_1m_dirty', synchronize: false })
export class Telemetry1mDirty {
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
