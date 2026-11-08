import 'reflect-metadata';
import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * The series catalogue of the OTel metrics adapter (docs/phases/42-telemetry/04 §4.2): one row per metric series a tenant has written
 * to the Core store (lane `otel`, kind `observability.series`). `seriesId` is the entity id of the series in the store
 * (`entityIdOf('observability.series', metric + its sorted labels)`); `labels` are the series' resource and data-point attributes as
 * strings (never a tenant key); `bounds` are a histogram's explicit upper bounds (the `bucket.<i>` keys of the series count against them).
 * Label matching, metric names over a range and the read scope of the kind are answered here; the numbers live in the store.
 */
@Entity('otel_series')
@Index('idx_otel_series_tenant_metric', ['tenantId', 'metric'])
@Index('idx_otel_series_tenant_seen', ['tenantId', 'lastSeenAt'])
export class OtelSeries {
  @PrimaryColumn({ type: 'uuid' })
  tenantId!: string;

  @PrimaryColumn({ type: 'uuid' })
  seriesId!: string;

  @Column({ type: 'varchar', length: 128 })
  metric!: string;

  /** gauge | sum | histogram */
  @Column({ type: 'varchar', length: 16 })
  kind!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  unit?: string | null;

  @Column({ type: 'jsonb' })
  labels!: Record<string, string>;

  @Column({ type: 'jsonb', nullable: true })
  bounds?: number[] | null;

  @Column({ type: 'timestamptz' })
  firstSeenAt!: Date;

  @Column({ type: 'timestamptz' })
  lastSeenAt!: Date;
}
