import 'reflect-metadata';
import { Entity, PrimaryColumn, Column } from 'typeorm';

/**
 * A slug that belonged to a purged tenant, blocked for good (docs/phases/02-fleet/02 section 3.5, 05 section 5.2): a squatter must never inherit a
 * deleted tenant's links, invitations or bookmarks. Written by the purge, read by every slug check of create and update. The row outlives its tenant
 * by design, so it is a system table (RLS-exempt): `tenantId` records whose slug it was, it does not scope the row.
 */
@Entity('tenant_slug_tombstones')
export class TenantSlugTombstone {
  @PrimaryColumn({ type: 'varchar', length: 63 })
  slug!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'timestamptz' })
  purgedAt!: Date;
}
