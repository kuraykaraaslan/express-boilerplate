import 'reflect-metadata';
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, DeleteDateColumn, Index, Check } from 'typeorm';

export const ALLOWED_REGIONS = ['TR', 'EU', 'US', 'APAC', 'LATAM', 'MEA'] as const;
export type TenantRegion = (typeof ALLOWED_REGIONS)[number];

/**
 * Who asked for a tenant's deletion (04-tenant-setting 1.7; tenant migration 134): the tenant's own OWNER through the deletion-request route, the
 * platform OPERATOR through its GLOBAL path, the FLEET control plane's `tenant.delete` command, or the last member's account SELF_SERVICE deletion.
 */
export const DELETION_REQUESTERS = ['OWNER', 'OPERATOR', 'FLEET', 'SELF_SERVICE'] as const;
export type DeletionRequester = (typeof DELETION_REQUESTERS)[number];

@Entity('tenants')
// A tombstone always knows where the tenant went and until when it redirects; a hold always says why; the version never goes negative.
// Same names in tenant migration 128, which adds them to databases built before.
@Check('ck_tenants_relocated', `"tenantStatus" <> 'RELOCATED' OR ("relocatedToNodeId" IS NOT NULL AND "relocatedToBaseUrl" IS NOT NULL AND "relocatedAt" IS NOT NULL AND "tombstoneUntil" IS NOT NULL)`)
@Check('ck_tenants_legal_hold', `"legalHoldUntil" IS NULL OR "legalHoldReason" IS NOT NULL`)
// Who stands behind a hold (decision F19; tenant migration 130): only a hold has an origin.
@Check('ck_tenants_legal_hold_origin', `"legalHoldOrigin" IS NULL OR ("legalHoldUntil" IS NOT NULL AND "legalHoldOrigin" IN ('CONTROL_PLANE', 'REGIONAL_OPERATOR', 'TENANT_DPO', 'MIXED'))`)
@Check('ck_tenants_assignment_version', `"assignmentVersion" >= 0`)
// Who asked for the deletion (04-tenant-setting 1.7; tenant migration 134): one of DELETION_REQUESTERS, or null.
@Check('ck_tenants_deletion_requested_by', `"deletionRequestedBy" IS NULL OR "deletionRequestedBy" IN ('OWNER', 'OPERATOR', 'FLEET', 'SELF_SERVICE')`)
// The tenant's country (phase 49.1; tenant migration 135): a country always says where it came from, and the code is two letters.
@Check('ck_tenants_country', `("countryCode" IS NULL AND "countrySource" IS NULL) OR ("countryCode" IS NOT NULL AND "countryCode" ~ '^[A-Z]{2}$' AND "countrySource" IS NOT NULL AND "countrySource" IN ('operator', 'geoip', 'locale', 'default'))`)
export class Tenant {
  @PrimaryGeneratedColumn('uuid', { name: 'tenantId' })
  tenantId!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ nullable: true, type: 'text' })
  description?: string;

  @Column({ type: 'varchar', default: 'ACTIVE' })
  tenantStatus!: string;

  // URL-safe unique handle for path-based tenancy (e.g. /t/acme-corp)
  @Index({ unique: true, where: '"slug" IS NOT NULL' })
  @Column({ nullable: true, type: 'varchar', length: 63 })
  slug?: string;

  // A locale and presentation hint validated against ALLOWED_REGIONS. NOT where the data lives: on a fleet node that is `homeRegionId` below
  // (docs/phases/02-fleet/02 section 3.6 renames this column `localeRegionHint` in a later contract step; the API keeps `region` until then).
  @Column({ nullable: true, type: 'varchar', length: 16 })
  region?: string;

  // The tenant's country, ISO 3166-1 alpha-2 (phase 49.1; tenant migration 135): the key its price list and payment options are looked up by (country, then
  // its bloc, then '*'). Set silently at sign-up from the request's geo-IP (else the browser language's region, else TR) and changed only by the platform
  // operator; `region` above is derived from it. Null on a tenant from before phase 49 (its pricing then starts from `region`).
  @Column({ nullable: true, type: 'varchar', length: 2 })
  countryCode?: string | null;

  // Where `countryCode` came from: operator | geoip | locale | default (COUNTRY_SOURCES in tenant.country.ts). Null exactly when the country is.
  @Column({ nullable: true, type: 'varchar', length: 16 })
  countrySource?: string | null;

  // Fleet federation (docs/phases/02-fleet/02 section 3.6, 05 sections 5.1 and 7). All null on a single deployment and on tenants created before
  // the node joined a fleet; set by the directory's `tenant.provision` (and later by migrations) on a node. Ids are the directory's, compared as
  // text: the region and node ids of `fleet_tenant_directory`.
  @Column({ nullable: true, type: 'varchar', length: 64 })
  homeRegionId?: string | null;

  @Column({ nullable: true, type: 'varchar', length: 64 })
  homeNodeId?: string | null;

  // A region id or a bloc code the tenant must stay inside (mirrors the directory).
  @Column({ nullable: true, type: 'varchar', length: 32 })
  residencyRequirement?: string | null;

  // A legal hold blocks deletion and migration until this instant (null = no hold).
  @Column({ nullable: true, type: 'timestamptz' })
  legalHoldUntil?: Date | null;

  @Column({ nullable: true, type: 'text' })
  legalHoldReason?: string | null;

  // Who placed the hold (tenant.legal-hold.ts): CONTROL_PLANE, REGIONAL_OPERATOR, TENANT_DPO, or MIXED once a second authority extended it. Lifting
  // early needs the control plane's class 3 or the same node-local authority; null on a hold placed before origins existed (class 3 only).
  @Column({ nullable: true, type: 'varchar', length: 24 })
  legalHoldOrigin?: string | null;

  // The tombstone a cutover leaves on the source node (status RELOCATED): where the tenant went, from the signed migration contract, and until
  // when this node keeps redirecting to it.
  @Column({ nullable: true, type: 'varchar', length: 64 })
  relocatedToNodeId?: string | null;

  @Column({ nullable: true, type: 'varchar', length: 255 })
  relocatedToBaseUrl?: string | null;

  @Column({ nullable: true, type: 'timestamptz' })
  relocatedAt?: Date | null;

  @Column({ nullable: true, type: 'timestamptz' })
  tombstoneUntil?: Date | null;

  // The directory's assignment version this row was last written at; 0 = never assigned by a directory.
  @Column({ type: 'int', default: 0 })
  assignmentVersion!: number;

  // When the directory's tenantStatusDelta fenced this node as the tenant's OLD home (decision F1, `fenceAfterDirectoryMove`; tenant migration 131):
  // from then on routing refuses the tenant here (FENCED) and the write fence opens every tenant-scoped transaction of it READ ONLY
  // (`db.write-fence.ts`), whatever its status. Null = not fenced; only a failback's go-live clears it.
  @Column({ nullable: true, type: 'timestamptz' })
  fencedAt?: Date | null;

  // The node this one last took the tenant over from in disaster recovery (decision F1, `takeOverTenantsForDr`; tenant migration 132): the failed
  // primary after a failover, the standby after a failback. A failback takes back exactly the tenants homed on the standby and stamped with its own id.
  // Null = never taken over.
  @Column({ nullable: true, type: 'varchar', length: 64 })
  drTakenFromNodeId?: string | null;

  // Arbitrary operator metadata: VAT number, CRM IDs, fiscal codes, etc.
  @Column({ nullable: true, type: 'jsonb', default: '{}' })
  metadata?: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamp', nullable: true })
  deletedAt?: Date;

  @Column({ nullable: true, type: 'timestamp' })
  deletionRequestedAt?: Date;

  @Column({ nullable: true, type: 'timestamp' })
  deleteAfter?: Date;

  // 1.7: who asked for the pending deletion (DELETION_REQUESTERS), written with deletionRequestedAt and cleared with it on cancel. Null on a deletion
  // requested before tenant migration 134: the owner's cancel treats that as the operator's (fail closed).
  @Column({ nullable: true, type: 'varchar', length: 16 })
  deletionRequestedBy?: DeletionRequester | null;

  // Purged tenants only: when the next file a module still retains needs a verdict (the earliest `retainUntil` of its live
  // `uploaded_files`), so the daily sweep visits only tenants with work. Null = no file of this tenant is waiting. tenant.purge-files.ts.
  @Column({ nullable: true, type: 'timestamp' })
  retainedFilesDueAt?: Date | null;

  // When this node actually PURGED the tenant (tenant migration 133; P7-TDEK): set by the deletion purge in the conditional update that claims the
  // row, and by a migration's source purge in the transaction that removes the tenant's rows (the RELOCATED tombstone stays). Unlike `deletedAt`,
  // which the admin soft delete sets too, it is what the key-shredding sweep trusts. Null = never purged here.
  @Column({ nullable: true, type: 'timestamptz' })
  purgedAt?: Date | null;
}
