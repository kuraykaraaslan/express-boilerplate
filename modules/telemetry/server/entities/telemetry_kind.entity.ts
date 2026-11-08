import 'reflect-metadata';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * The registry of entity kinds as the database knows them (docs/phases/42-telemetry/00 ED-10): a kind name and the small id the
 * raw, minute and latest rows carry in `kindId`. Platform reference data shared by every tenant (no tenant rows; RLS-exempt by
 * design, `modules/db/scripts/rls-exempt.ts`). Created by migration 002 (`synchronize: false`); id 1 is `iot_device`, the kind of
 * every row an IoT-era install held before the column existed. Ids are never reused.
 */
@Entity({ name: 'telemetry_kinds', synchronize: false })
export class TelemetryKind {
  @PrimaryGeneratedColumn('identity', { type: 'smallint', generatedIdentity: 'BY DEFAULT' })
  kindId!: number;

  /** The `telemetry:entity_kind` name (`iot_device`, `fx.currency`, …). */
  @Column({ type: 'varchar', length: 64 })
  kind!: string;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;
}
