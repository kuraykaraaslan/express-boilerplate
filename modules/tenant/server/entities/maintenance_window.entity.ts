import 'reflect-metadata';
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * A planned, temporary outage window — system-wide, per-tenant, or per-route.
 *
 * Lives in the SYSTEM datasource (like `tenants` itself): a `tenantId = null`
 * row freezes every tenant at once, which no per-tenant table could express.
 * The tenant's own `tenantStatus` is never touched by maintenance (locked
 * decision) — this table is the only place "in maintenance" exists.
 */
@Entity('maintenance_windows')
// The hot-path query: active windows for (system ∪ one tenant) by time range.
@Index(['tenantId', 'status', 'scheduledStart', 'scheduledEnd'])
export class MaintenanceWindow {
  @PrimaryGeneratedColumn('uuid', { name: 'windowId' })
  windowId!: string;

  /** null = the WHOLE platform (every tenant). */
  @Column({ nullable: true, type: 'uuid' })
  tenantId?: string | null;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  /** Shown to end users on the 503 page. */
  @Column({ nullable: true, type: 'text' })
  message?: string | null;

  /** SYSTEM | TENANT | ROUTE (maintenance.enums.ts). */
  @Column({ type: 'varchar', length: 20, default: 'TENANT' })
  scope!: string;

  /**
   * For scope=ROUTE: app-relative path patterns (`/admin/store/*`). `*` is the
   * only wildcard. null for SYSTEM/TENANT scopes.
   */
  @Column({ nullable: true, type: 'jsonb' })
  routePatterns?: string[] | null;

  /** SCHEDULED | IN_PROGRESS | COMPLETED | CANCELLED (maintenance.enums.ts). */
  @Column({ type: 'varchar', length: 20, default: 'SCHEDULED' })
  status!: string;

  /** FULL | READ_ONLY (maintenance.enums.ts) — READ_ONLY lets safe methods through. */
  @Column({ type: 'varchar', length: 20, default: 'FULL' })
  mode!: string;

  /**
   * Canary share [1..100]: the percentage of subjects that SEE the maintenance.
   * null = everyone. Buckets through feature_flags' deterministic SHA-256, so
   * a subject is stably in or out for the window's whole life.
   */
  @Column({ nullable: true, type: 'int' })
  percentage?: number | null;

  /** When the one advance notice went out — the scheduler's idempotency marker. */
  @Column({ nullable: true, type: 'timestamp' })
  preNotifiedAt?: Date | null;

  @Column({ type: 'timestamp' })
  scheduledStart!: Date;

  /** null = open-ended (Retry-After falls back to a coarse hint). */
  @Column({ nullable: true, type: 'timestamp' })
  scheduledEnd?: Date | null;

  @Column({ nullable: true, type: 'timestamp' })
  actualStart?: Date | null;

  @Column({ nullable: true, type: 'timestamp' })
  actualEnd?: Date | null;

  /**
   * The escape hatch (locked decision): member roles that pass the gate while
   * the window is active. Validation refuses an empty list — an empty list is
   * how an operator locks themselves out.
   */
  @Column({ type: 'jsonb', default: () => `'["OWNER","ADMIN"]'` })
  allowRoles!: string[];

  @Column({ nullable: true, type: 'uuid' })
  createdByUserId?: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
