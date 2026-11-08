import 'reflect-metadata';
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Who set a ban: the strike store (`auto`), a platform administrator (`manual`) or the AI firewall's responder (`firewall`). */
export const IP_BAN_SOURCES = ['auto', 'manual', 'firewall'] as const;
export type IpBanSource = (typeof IP_BAN_SOURCES)[number];

/** What a ban covers: one address (an IPv4 address, or the /64 of an IPv6 address, the limiter's bucket) or a CIDR block. */
export type IpBanKind = 'address' | 'cidr';

/**
 * The durable copy of an address ban (docs/phases/55-ai-firewall 00 §0.2, P-2). Redis holds the hot copy the proxy reads on every
 * request (`ip-ban:<target>`, limiter.ip-strikes.ts); this table holds every ban that must outlive a Redis flush: every manual and
 * firewall ban, and every automatic ban longer than an hour (`PERSIST_MIN_SECONDS`, limiter.ip-ban-store.ts). After a flush the store
 * rebuilds the Redis keys of the rows still in force (`rebuildIfFlushed`).
 *
 * Installation-wide ROOT data: an address is banned for the whole installation, so the row has no tenant column and is RLS-exempt
 * (`modules/db/scripts/rls-exempt.ts` gives the reason); only the limiter reads or writes it, behind the root super-admin routes and
 * the strike store. A row is never deleted while it matters: a lift sets `liftedAt` / `liftedBy`, a newer ban on the same target lifts
 * the older row, and rows that ended more than `HISTORY_DAYS` ago are pruned by the rebuild. Created by migration 001 (same names).
 */
@Entity('security_ip_bans')
@Index('IDX_security_ip_bans_target', ['target'])
@Index('IDX_security_ip_bans_expires', ['expiresAt'])
export class SecurityIpBan {
  /** Migration 001 defaults it to `gen_random_uuid()`. */
  @PrimaryGeneratedColumn('uuid', { name: 'banId', primaryKeyConstraintName: 'PK_security_ip_bans' })
  banId!: string;

  /** The canonical target: an IPv4 address, an IPv6 /64 bucket (`2001:db8:1:2::/64`) or a masked CIDR block (`10.20.0.0/16`). */
  @Column({ type: 'varchar', length: 64 })
  target!: string;

  @Column({ type: 'varchar', length: 8 })
  kind!: IpBanKind;

  @Column({ type: 'varchar', length: 200 })
  reason!: string;

  @Column({ type: 'varchar', length: 16 })
  source!: IpBanSource;

  /** The repeat-offense step of an automatic ban (1 for a manual one). */
  @Column({ type: 'integer', default: 1 })
  offense!: number;

  /** The administrator who set a manual ban; null for an automatic or firewall ban. */
  @Column({ type: 'uuid', nullable: true })
  actorId!: string | null;

  @Column({ type: 'timestamptz' })
  bannedAt!: Date;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  /** When the ban was lifted (by an administrator, or replaced by a newer ban on the same target); null while it stands. */
  @Column({ type: 'timestamptz', nullable: true })
  liftedAt!: Date | null;

  /** The administrator who lifted it; null for a ban replaced by a newer one or lifted by the system. */
  @Column({ type: 'uuid', nullable: true })
  liftedBy!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
