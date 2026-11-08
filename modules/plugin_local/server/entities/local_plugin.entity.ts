import 'reflect-metadata';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
  Check,
} from 'typeorm';

/** `active` runs wherever it is installed; `disabled` is the operator's kill switch: no tenant runs it, installs stay. */
export type LocalPluginStatus = 'active' | 'disabled';

/**
 * A sandboxed plugin the platform operator uploaded directly (OD-139: the Core
 * source of sandboxed plugins, without the Enterprise marketplace).
 *
 * System-scoped and ROOT-only: one catalogue the operator manages from the root
 * tenant; tenants never read this table, they see only what the operator installed
 * for them (the `installs` ledger + `plugin.local.<pluginId>.*` settings). RLS-exempt
 * like `marketplace_listings`, for the same reason.
 *
 * `scopedName` is the operator's stable name (`@acme/pay` or `acme_pay`); the
 * runtime plugin id is `local/<scopedName>`, which no marketplace scoped name can be.
 */
@Entity('plugin_local_plugins')
@Check('ck_plugin_local_plugins_status', `"status" IN ('active', 'disabled')`)
export class LocalPlugin {
  @PrimaryGeneratedColumn('uuid', { name: 'pluginId' })
  pluginId!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 120 })
  scopedName!: string;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'varchar', default: 'active' })
  status!: LocalPluginStatus;

  /** The highest approved, non-yanked version: what a new install gets. Null until one is approved. */
  @Column({ type: 'uuid', nullable: true })
  currentVersionId!: string | null;

  /** ROOT admin who uploaded the first version. */
  @Column({ type: 'uuid', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
