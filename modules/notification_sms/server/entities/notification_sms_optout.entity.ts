import 'reflect-metadata';
import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * A recipient's SMS opt-out state for one tenant (docs/audits/2026-11-03-redis-outage.md §6.7 item 2, decision D254): the durable record of a STOP
 * (or of the START that took it back), written before anything else when a carrier reply carries the keyword, and the source of truth the send
 * path reads (Redis only caches it; `notification_sms.optout.ts`). Before D254 the list lived in a Redis set only, so a Redis that lost its data
 * forgot every opt-out.
 *
 * One row per (tenant, number): the number in canonical E.164 (`common.phone` `toE164`), so `0532 …`, `+90 532 …` and `90532…` are one subscriber.
 * The number is stored in clear, not sealed under the tenant key with a blind index like `notification_logs.recipient`: the lookup must answer on
 * every node and across every key generation, because a missed lookup is a message sent to someone who said STOP. The column is named `phone`, so a
 * redacted tenant export redacts it. Kept on a subject's erasure (the record of the objection is what keeps it honoured: RETAIN, LEGAL_OBLIGATION,
 * module.json), deleted with the tenant by the purge step. Tenant-scoped, RLS forced from birth (migration 002).
 */
@Entity('notification_sms_optouts')
export class NotificationSmsOptOut {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'PK_notification_sms_optouts' })
  tenantId!: string;

  /** E.164, e.g. `+905321234567`. */
  @PrimaryColumn({ type: 'varchar', length: 16, primaryKeyConstraintName: 'PK_notification_sms_optouts' })
  phone!: string;

  /** True after a STOP, false after a START: the row is kept either way, as the subject's record. */
  @Column({ type: 'boolean' })
  optedOut!: boolean;

  /** The keyword that set the state, upper-cased (`STOP`, `IPTAL`, `START`, …). */
  @Column({ type: 'varchar', length: 16 })
  keyword!: string;

  /** When the state was last set. */
  @Column({ type: 'timestamptz' })
  changedAt!: Date;

  /** When the number first sent a keyword to this tenant. */
  @Column({ type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;
}
