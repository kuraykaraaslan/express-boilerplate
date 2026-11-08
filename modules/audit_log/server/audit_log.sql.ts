import type { EntityTarget, QueryRunner } from 'typeorm';
import { AuditLog as AuditLogRow } from './entities/audit_log.entity';
import { AuditActorIdentity } from './entities/audit_actor_identity.entity';
import { AuditChainCheckpoint } from './entities/audit_chain_checkpoint.entity';
import { AuditChainAnchor } from './entities/audit_chain_anchor.entity';
import { AuditLegacyChainHead } from './entities/audit_legacy_chain_head.entity';

/**
 * Names for the hand-written SQL of this module (the sealed insert, the identity mapping insert, the verifier).
 *
 * TypeORM qualifies every table it writes with the schema of its DataSource, but it does not set a `search_path`, so raw
 * SQL with a bare name only works when the schema is on the connection's default path (`public`). A tenant database or a
 * test schema is not, so a raw statement asks the connection where the table really is, once, and qualifies with that.
 * The database functions live next to the tables (migration 002 creates them in the schema it is applied to).
 */
export interface AuditSqlNames {
  auditLogs: string;
  actorIdentities: string;
  checkpoints: string;
  anchors: string;
  /** The legacy chain's anchor (audit_log.11), migration 012. */
  legacyHeads: string;
  /** A function of audit_log migration 002, qualified like the tables. */
  fn: (name: string) => string;
}

export function auditSqlNames(qr: QueryRunner): AuditSqlNames {
  const escape = (part: string): string => qr.connection.driver.escape(part);
  const path = (entity: EntityTarget<unknown>): string => qr.connection.getMetadata(entity).tablePath.split('.').map(escape).join('.');
  const auditLogs = path(AuditLogRow);
  const parts = qr.connection.getMetadata(AuditLogRow).tablePath.split('.');
  const schema = parts.length > 1 ? escape(parts[0]!) : null;
  return {
    auditLogs,
    actorIdentities: path(AuditActorIdentity),
    // lazy: only the checkpoint read needs the entity, and a DataSource that predates it must keep working for every other statement
    get checkpoints() { return path(AuditChainCheckpoint); },
    get anchors() { return path(AuditChainAnchor); },
    get legacyHeads() { return path(AuditLegacyChainHead); },
    fn: (name) => (schema ? `${schema}.${name}` : name),
  };
}
