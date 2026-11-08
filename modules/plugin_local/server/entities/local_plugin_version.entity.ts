import 'reflect-metadata';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
} from 'typeorm';

/**
 * One uploaded version of a local plugin (see LocalPlugin). System-scoped, ROOT-only.
 *
 * Lifecycle: uploaded (sandboxJson null) → approved (the operator granted a sandbox,
 * sandboxJson set) → optionally yanked (never installable or runnable again).
 * `manifestJson` is the manifest as uploaded and never edited; what the plugin may do
 * at runtime comes ONLY from `sandboxJson`, the grant the operator approved (capped at
 * the platform maximum), never from the live manifest.
 */
@Entity('plugin_local_versions')
@Index('uq_plugin_local_versions_plugin_version', ['pluginId', 'version'], { unique: true })
export class LocalPluginVersion {
  @PrimaryGeneratedColumn('uuid', { name: 'versionId' })
  versionId!: string;

  @Index()
  @Column({ type: 'uuid' })
  pluginId!: string;

  /** Semver, strictly increasing per plugin. */
  @Column({ type: 'varchar', length: 64 })
  version!: string;

  @Column({ type: 'text' })
  manifestJson!: string;

  /** The APPROVED sandbox grant (capabilities, httpAllowlist, httpAllowlistFromSettings, limits). Null until approved. */
  @Column({ type: 'text', nullable: true })
  sandboxJson!: string | null;

  /** Storage key of the bundle (ROOT tenant, folder `plugin-bundles`). */
  @Column({ type: 'varchar' })
  bundleKey!: string;

  /** Bare-uuid link to the bundle's UploadedFile audit row (ROOT), where the virus-scan verdict lives. */
  @Column({ type: 'uuid', nullable: true })
  bundleUploadedFileId!: string | null;

  /** SHA-256 (hex) of the bundle bytes as stored, computed by the server; re-checked at install and on every cold load. */
  @Column({ type: 'varchar', length: 64 })
  bundleSha256!: string;

  /** Detached Ed25519 signature (base64) over the digest, made with an operator-registered key. */
  @Column({ type: 'text', nullable: true })
  signature!: string | null;

  /** The kid of the trusted key (ROOT setting pluginLocalTrustedKeys) the signature verified against. */
  @Column({ type: 'varchar', length: 100, nullable: true })
  signerKid!: string | null;

  @Column({ type: 'boolean', default: false })
  signatureVerified!: boolean;

  @Column({ type: 'uuid', nullable: true })
  uploadedBy!: string | null;

  @Column({ type: 'uuid', nullable: true })
  approvedBy!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  approvedAt!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  yankedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  yankedReason!: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;
}
