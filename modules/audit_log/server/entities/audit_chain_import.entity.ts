import 'reflect-metadata';
import { Entity, PrimaryColumn, Column, CreateDateColumn, Index, Check } from 'typeorm';

/**
 * A tenant's audit history as it arrived with a migration (docs/phases/02-fleet/05-tenancy-and-routing.md section 6.4 "Audit chain").
 *
 * The importing node keeps the source's rows verbatim, hashes included, so its own chain continues on top of them. Whether that history is EVIDENCE
 * depends on two things the import establishes once and this row keeps: the chain recomputes link by link in the database (`chainStatus`, from the newest
 * checkpoint the bundle carried), and its head was proven against the control plane's acknowledgement of the source's audit root (`headProven`, checked
 * by the node app against its installed trust bundle before any row was written). Both: `PROVEN`. Otherwise every row up to and including
 * `(coveredThrough, coveredThroughId)` is `IMPORTED_UNVERIFIED`: kept, readable, chained on, but never presented as witnessed history. `EMPTY`: the bundle
 * carried no audit row and no checkpoint, so there is nothing to vouch for.
 *
 * Written ONLY by `audit_chain_import_record` (migration 011), inside the transaction that restored the rows (`audit_chain_import_begin`): it reads the
 * boundary and walks the chain itself, so no caller can name rows or a chain status. The rows travel with the tenant like the checkpoints do, so a history
 * moved twice keeps the record of both moves.
 */
@Entity('audit_chain_imports')
@Index('IDX_audit_chain_imports_tenant_imported', ['tenantId', 'importedAt'])
@Check('ck_audit_chain_imports_values', `"verdict" IN ('PROVEN', 'IMPORTED_UNVERIFIED', 'EMPTY') AND "chainStatus" IN ('VERIFIED', 'BROKEN', 'NOT_VERIFIABLE') AND "rowCount" >= 0 AND ("headHash" IS NULL OR "headHash" ~ '^[a-f0-9]{64}$') AND ("coveredThrough" IS NULL) = ("coveredThroughId" IS NULL) AND ("verdict" = 'EMPTY') = ("coveredThroughId" IS NULL) AND ("verdict" <> 'PROVEN' OR ("headProven" AND "chainStatus" = 'VERIFIED'))`)
export class AuditChainImport {
  @PrimaryColumn({ type: 'uuid', default: () => 'gen_random_uuid()' })
  importId!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  /** The node the history came from (the migration contract's source). */
  @Column({ type: 'varchar', length: 64 })
  sourceNodeId!: string;

  /** PROVEN | IMPORTED_UNVERIFIED | EMPTY. */
  @Column({ type: 'varchar', length: 24 })
  verdict!: string;

  /** VERIFIED (every link recomputes) | BROKEN (a row does not) | NOT_VERIFIABLE (a v1 row, which only JavaScript can recompute, stopped the walk). */
  @Column({ type: 'varchar', length: 16 })
  chainStatus!: string;

  /** The bundle's proof of the head verified against the control plane's keys and named the source node. */
  @Column({ type: 'boolean' })
  headProven!: boolean;

  /** `createdAt` of the newest imported row (or of the newest imported checkpoint, when the retention purge kept no row). */
  @Column({ type: 'timestamp', nullable: true })
  coveredThrough!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  coveredThroughId!: string | null;

  /** The hash that row (or checkpoint) had: the link the first row written here chains to (null for a legacy row written without one). */
  @Column({ type: 'varchar', length: 64, nullable: true })
  headHash!: string | null;

  /** Audit rows imported (kept rows; purged ones are in the checkpoints). */
  @Column({ type: 'int' })
  rowCount!: number;

  @CreateDateColumn({ type: 'timestamp' })
  importedAt!: Date;
}
