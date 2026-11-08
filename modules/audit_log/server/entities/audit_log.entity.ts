import 'reflect-metadata';
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, DeleteDateColumn, Index } from 'typeorm';

// Compound index backing the hot read path: getAll always filters by tenantId
// and orders by createdAt DESC. Without it, large tenants pay an index scan on
// tenantId followed by a sort.
@Index('IDX_audit_logs_tenant_created', ['tenantId', 'createdAt'])
// "What did this pseudonymous actor do": the read side resolves an actor id to its refs through
// `audit_actor_identities` and then filters on (tenantId, actorRef). Mirrors the index of migration
// audit_log:001, because `synchronize` drops an index the entity does not declare.
@Index('IDX_audit_logs_tenant_actor_ref', ['tenantId', 'actorRef'])
// "How many rows of these exact actions did this tenant write in this window, and which are the newest" (the AI firewall's
// activity page, audit_log.query actionActivityCrossTenant): one index range per action instead of every row of the window.
// Mirrors migration audit_log:013.
@Index('IDX_audit_logs_tenant_action_created', ['tenantId', 'action', 'createdAt'])
@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid', { name: 'auditLogId' })
  auditLogId!: string;

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string;

  @Index()
  @Column({ nullable: true, type: 'uuid' })
  actorId?: string | null;

  @Column({ type: 'varchar', default: 'SYSTEM' })
  actorType!: string;

  // Dual-actor (impersonation context): when a platform admin acts on behalf of
  // a tenant user, `actorId` stays the TRUE actor (the admin) and
  // `onBehalfOfActorId` carries the impersonated user. Nullable + additive so
  // callers that don't set it (the common case) are unaffected.
  @Index()
  @Column({ nullable: true, type: 'uuid' })
  onBehalfOfActorId?: string | null;

  // Cross-tenant actor: set when the actor's membership lives in ANOTHER tenant and they acted here (today a Fleet
  // break-glass session, attributed to the fleet tenant). `actorId` is still the person; this is where they came from.
  // Null for everyone acting in their own tenant, which is nearly every row. Stamped from the request context
  // (`audit_log.context`), not by call sites. Indexed with tenantId because the one question asked of it is "who acted
  // here from another tenant", newest first.
  @Index('IDX_audit_logs_tenant_actor_tenant', ['tenantId', 'actorTenantId', 'createdAt'])
  @Column({ nullable: true, type: 'uuid' })
  actorTenantId?: string | null;

  // Pseudonymous actor reference (hardened chain, hashVersion 2): base64url(HMAC(per-tenant key, actorId)).
  // The identity lives only in `audit_actor_identities`; deleting that mapping row is the erasure, and no
  // hashed column changes. Null on legacy (hashVersion NULL) rows, which still carry `actorId`.
  @Column({ type: 'varchar', length: 64, nullable: true })
  actorRef?: string | null;

  // The same pseudonym for the impersonated user (`onBehalfOfActorId` on legacy rows).
  @Column({ type: 'varchar', length: 64, nullable: true })
  onBehalfOfRef?: string | null;

  // SERVICE actors (fleet command executions): the signed command that caused the act, and the node it ran on.
  // Covered by the v2 hash; legacy rows never carry them (the v1 hash cannot cover a new column).
  @Column({ type: 'uuid', nullable: true })
  commandJti?: string | null;

  @Column({ type: 'uuid', nullable: true })
  nodeId?: string | null;

  @Index()
  @Column({ type: 'varchar' })
  action!: string;

  // Risk classification for the action (low | medium | high | critical).
  @Index()
  @Column({ type: 'varchar', default: 'low' })
  severity!: string;

  @Index()
  @Column({ nullable: true, type: 'varchar' })
  resourceType?: string | null;

  @Column({ nullable: true, type: 'varchar' })
  resourceId?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: unknown;

  @Column({ nullable: true, type: 'varchar' })
  ipAddress?: string | null;

  @Column({ nullable: true, type: 'text' })
  userAgent?: string | null;

  // Append-only hash chain (tamper evidence). `rowHash` = sha256(prevHash +
  // canonical(row)); `prevHash` is the previous row's rowHash for the same
  // tenant (null for the first row). verifyChain() recomputes and compares.
  @Column({ nullable: true, type: 'varchar' })
  prevHash?: string | null;

  @Column({ nullable: true, type: 'varchar' })
  rowHash?: string | null;

  // Which algorithm produced `rowHash`: NULL = v1 (JavaScript, `computeRowHash`), 2 = v2 (PostgreSQL,
  // `audit_row_hash()` in the BEFORE INSERT trigger). Set by the trigger only; a writer that supplies its own
  // hash cannot claim v2. The verifier dispatches per row, so both versions coexist in one chain.
  @Column({ type: 'smallint', nullable: true })
  hashVersion?: number | null;

  // The keyed legacy chain (audit_log.02 / .12, 2026-10-20): the keyed digest of the person-bearing fields (actor, on-behalf-of,
  // metadata, IP, user agent) that the row hash covers in their place, and the keyed seal an erasure writes over what it left.
  // NULL on v1 rows and on sealed (hashVersion 2) rows.
  @Column({ type: 'varchar', length: 64, nullable: true })
  subjectDigest?: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  erasureSeal?: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  // Soft-delete guard. Normal reads (getAll) exclude soft-deleted rows; the
  // retention purge hard-deletes after archiving.
  @DeleteDateColumn({ type: 'timestamp', nullable: true })
  deletedAt?: Date | null;
}
