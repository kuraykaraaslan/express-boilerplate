import 'reflect-metadata';
import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Check,
} from 'typeorm';
import type { InstallOrigin, ClosedReason } from '../module-lifecycle.types';

/** What kind of artifact an install row records. */
export type InstallArtifactType = 'module' | 'plugin';

/**
 * THE per-tenant install ledger — the single authority for "installed" and
 * "active", for both built-in modules and community plugins (audit-fix Faz 3).
 * "Installed" used to live in four places (this table's `module_installs`
 * predecessor, the `module.<id>.enabled` setting, the
 * `plugin.community.<listingId>.{version,active}` settings and the cross-tenant
 * `CommunityInstall` analytics row) with no single writer; they drifted.
 *
 * Polymorphic seam per AGENTS.md §10.2: `artifactType` + `artifactId`, where
 * artifactId is a moduleId for 'module' rows, and for 'plugin' rows either a
 * marketplace listingId (a bare uuid) or `local:<pluginId>` for a plugin the
 * platform operator installed from its own store (plugin_local, OD-139; see
 * plugin_runtime/server/broker/install-keys `isLocalPluginArtifact`).
 *
 * The old records DO remain, as read projections fed only by this ledger's
 * writers (module-lifecycle.service for modules / marketplace's community-install.service.next for marketplace
 * plugins / plugin_local.install.service for local plugins):
 *   - `module.<id>.enabled` — hot-path gate read by getEnabledModuleIds
 *     (settings are Redis-cached; the gate never queries this table),
 *   - `plugin.community.<listingId>.{version,active}` — read by the
 *     plugin_runtime broker (the isolate side never changes),
 *   - `plugin.local.<pluginId>.{version,active}` — read by plugin_local's resolver,
 *   - `CommunityInstall` — cross-tenant analytics, owned by the registry sink
 *     (marketplace_developer, MIS-08).
 *
 * Tenant isolation is via the `tenantId` column (like every other tenant-scoped
 * table here) — NOT a Postgres schema. The registry labels it tenant-scoped from
 * that column; the marketplace purge keys off `hasTenantId`, not the label.
 */
@Entity('installs')
@Check('ck_installs_origin', `"origin" IS NULL OR "origin" IN ('tenant', 'plan', 'operator', 'default')`)
@Check('ck_installs_closed_reason', `"closedReason" IS NULL OR "closedReason" IN ('entitlement', 'policy', 'retired')`)
export class Install {
  @PrimaryColumn({ type: 'uuid' })
  tenantId!: string;

  @PrimaryColumn({ type: 'varchar' })
  artifactType!: InstallArtifactType;

  /** moduleId (artifactType 'module'), or listingId / `local:<pluginId>` (artifactType 'plugin'). */
  @PrimaryColumn({ type: 'varchar' })
  artifactId!: string;

  /** Manifest version ('module'), or PublishedModuleVersion.versionId / LocalPluginVersion.versionId ('plugin'). */
  @Column({ type: 'varchar' })
  version!: string;

  /** Active (enabled) vs installed-but-deactivated. */
  @Column({ type: 'boolean', default: true })
  active!: boolean;

  /**
   * `'release' | 'test'` (roadmap 09-internal-testing.md). AUTHORITY for
   * which channel a plugin install runs on — `plugin.community.<listingId>.channel`
   * is a read projection of this, same discipline as `version`/`active`.
   * Meaningless for `artifactType: 'module'` rows (built-in modules have no
   * channel concept), which is why it defaults to the value that means
   * nothing changed rather than a null the module half would have to ignore.
   */
  @Column({ type: 'varchar', default: 'release' })
  channel!: 'release' | 'test';

  /**
   * Who installed a MODULE row (docs/phases/25-marketplace/03-module-governance/06):
   * the tenant itself, a plan, the platform operator, or the platform's
   * default-module list. Set when the row is created, never changed by a later
   * install. Null on rows written before the column existed, which read as
   * 'tenant'; meaningless for plugin rows.
   */
  @Column({ type: 'varchar', nullable: true })
  origin!: InstallOrigin | null;

  /**
   * Why the PLATFORM closed this row ('entitlement' | 'policy' | 'retired'); null
   * while active or when a person deactivated it. Plan provisioning reactivates
   * only an 'entitlement' close, so a tenant's own "off" survives a renewal.
   */
  @Column({ type: 'varchar', nullable: true })
  closedReason!: ClosedReason | null;

  /**
   * Set by `uninstall` (docs/phases/37-extensions/08): the module is off and its data kept until
   * `restorableUntil`, when the purge job removes both. Null while installed. Restoring clears both.
   */
  @Column({ type: 'timestamp', nullable: true })
  uninstalledAt!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  restorableUntil!: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  installedAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
