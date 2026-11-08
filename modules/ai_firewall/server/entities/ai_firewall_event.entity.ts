import 'reflect-metadata';
import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * One stored security signal (docs/phases/55-ai-firewall/01 §1.3, §1.7): what the fw:signals consumer writes
 * (`store/ai_firewall.signal-consumer.ts`), append-only. The columns are the signal's fields; `attrs` keeps its attributes as the
 * contract bounded them (request-controlled strings stay wrapped as `{ untrusted: true, text }`).
 *
 * A time-series table (`db:time_series`, `ai_firewall.timeseries.ts`): a hypertable behind `ai_firewall_events_v` with 1-day chunks
 * where TimescaleDB is present, else a plain table; either way the per-tenant retention job deletes what is past the tenant's setting
 * (default 90 days). The key starts with the tenant and holds the time column (the db:time_series contract); `signalId` makes a
 * redelivered entry insert nothing twice. Platform signals are stored under the ROOT tenant (`ai_firewall.store.ts`). Personal data:
 * `actorId` (a user id, an address), `subjectId`, `attrs.ip` and `attrs.userAgent`; exported by `ai_firewall.export-collection.ts`,
 * erased by `ai_firewall.privacy-erasure.ts`. Tenant-scoped (tenant RLS, FORCE). Created in SQL by migration 001 with the same names.
 */
@Entity('ai_firewall_events')
@Index('idx_ai_firewall_events_actor', ['tenantId', 'actorKind', 'actorId', 'at'])
@Index('idx_ai_firewall_events_kind', ['tenantId', 'kind', 'at'])
export class AiFirewallEvent {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'PK_ai_firewall_events' })
  tenantId!: string;

  /** When it happened (the producer's clock, ISO in the signal). */
  @PrimaryColumn({ type: 'timestamptz', primaryKeyConstraintName: 'PK_ai_firewall_events' })
  at!: Date;

  /** The signal's id (a uuid assigned at emit, at most 128 characters by the contract). */
  @PrimaryColumn({ type: 'varchar', length: 128, primaryKeyConstraintName: 'PK_ai_firewall_events' })
  signalId!: string;

  /** The lane (38 L-4) or `unknown`. */
  @Column({ type: 'varchar', length: 32 })
  lane!: string;

  /** Registered in `ai_firewall:signal`, e.g. `auth.login_failed`. */
  @Column({ type: 'varchar', length: 128 })
  kind!: string;

  /** `user` | `session` | `ip` | `apiKey` | `device` | `node` | `anon`. */
  @Column({ type: 'varchar', length: 16 })
  actorKind!: string;

  @Column({ type: 'varchar', length: 128 })
  actorId!: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  subjectType!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  subjectId!: string | null;

  /** `allow` | `deny` | `fail` | `info`. */
  @Column({ type: 'varchar', length: 8 })
  outcome!: string;

  /** `info` | `low` | `medium` | `high` | `critical`. */
  @Column({ type: 'varchar', length: 8 })
  severity!: string;

  @Column({ type: 'jsonb' })
  attrs!: Record<string, unknown>;

  /** The module that produced it. */
  @Column({ type: 'varchar', length: 64 })
  source!: string;

  /** When the consumer stored it. */
  @Column({ type: 'timestamptz', default: () => 'now()' })
  storedAt!: Date;
}
