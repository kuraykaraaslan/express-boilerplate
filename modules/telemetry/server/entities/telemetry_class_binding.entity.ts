import 'reflect-metadata';
import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * A tenant's retention class history PER KIND (docs/phases/42-telemetry/00 §0.5): the current binding of `(tenantId, entityType)`
 * has `validTo` NULL (one per tenant and kind, a partial unique index of migration 001). The writer records the class of a tenant's
 * first write of the kind; a plan change (`42/02` §2.8) closes the row and opens the next, and reads cover every class whose
 * validity and retention reach the window.
 */
@Entity({ name: 'telemetry_class_bindings', synchronize: false })
export class TelemetryClassBinding {
  @PrimaryColumn({ type: 'uuid' })
  tenantId!: string;

  /** The kind (`telemetry:entity_kind` name). */
  @PrimaryColumn({ type: 'varchar', length: 64 })
  entityType!: string;

  @PrimaryColumn({ type: 'timestamptz' })
  validFrom!: Date;

  /** 7, 30, 90, 365 or 1 095 (`RETENTION_CLASSES`). */
  @Column({ type: 'int' })
  classDays!: number;

  @Column({ type: 'timestamptz', nullable: true })
  validTo!: Date | null;
}
