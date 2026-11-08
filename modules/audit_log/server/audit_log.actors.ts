import 'reflect-metadata';
import { In, type QueryRunner } from 'typeorm';
import { AuditActorIdentity } from './entities/audit_actor_identity.entity';
import { AuditLogSchema, type AuditLog } from './audit_log.types';

/**
 * The read side of the pseudonymous actor references (hardened chain, hashVersion 2).
 *
 * A sealed row has `actorId` NULL and names its actor by `actorRef`; this is the one place that turns the reference
 * back into the id, through `audit_actor_identities`. Everything is a LEFT lookup: a legacy row still carries its
 * `actorId` and is returned exactly as before, and a sealed row whose mapping was erased resolves to null (the UI shows
 * it as anonymised). Callers pass the QueryRunner of the tenant transaction they already read the rows in, so the mapping is
 * read from the same database (a tenant may live in a dedicated one) and the same snapshot.
 *
 * Other modules that read `audit_logs` directly (tenant_export, tax, the activity timelines) should call
 * `resolveActors` once on their rows instead of reading `actorId` off the entity.
 */

interface ActorRow {
  tenantId: string;
  actorId?: string | null;
  actorRef?: string | null;
  onBehalfOfActorId?: string | null;
  onBehalfOfRef?: string | null;
}

/** Every actorRef the mapping holds for `actorId` in this tenant (more than one after a key rotation). */
export async function actorRefsOf(qr: QueryRunner, tenantId: string, actorId: string): Promise<string[]> {
  const rows = await qr.manager.getRepository(AuditActorIdentity).find({ where: { tenantId, actorId } });
  return rows.map((r) => r.actorRef).filter((ref): ref is string => typeof ref === 'string' && ref.length > 0);
}

/**
 * `rows` with `actorId` / `onBehalfOfActorId` filled from the mapping wherever the row names its actor by reference. A
 * row that already carries an id, or carries no reference, is returned as it is; no query is made when no row needs one.
 */
export async function resolveActors<T extends ActorRow>(qr: QueryRunner, tenantId: string, rows: T[]): Promise<T[]> {
  const refs = new Set<string>();
  for (const row of rows) {
    if (!row.actorId && row.actorRef) refs.add(row.actorRef);
    if (!row.onBehalfOfActorId && row.onBehalfOfRef) refs.add(row.onBehalfOfRef);
  }
  if (refs.size === 0) return rows;

  const found = await qr.manager.getRepository(AuditActorIdentity).find({ where: { tenantId, actorRef: In([...refs]) } });
  const byRef = new Map(found.map((m) => [m.actorRef, m.actorId]));
  return rows.map((row) => {
    const actorId = !row.actorId && row.actorRef ? byRef.get(row.actorRef) ?? null : row.actorId;
    const onBehalfOfActorId = !row.onBehalfOfActorId && row.onBehalfOfRef ? byRef.get(row.onBehalfOfRef) ?? null : row.onBehalfOfActorId;
    return { ...row, actorId, onBehalfOfActorId };
  });
}

const ADDITIVE_KEYS = ['actorRef', 'onBehalfOfRef', 'commandJti', 'nodeId', 'hashVersion'] as const;

/**
 * One stored row as the API shape. The hardened-chain columns are present only on rows that carry them, so a legacy row
 * serialises byte-for-byte as it did before the columns existed (no `"actorRef":null` appearing in every export).
 */
export function toAuditLog(row: unknown): AuditLog {
  const parsed = AuditLogSchema.parse(row);
  for (const key of ADDITIVE_KEYS) {
    if (parsed[key] == null) delete parsed[key];
  }
  return parsed;
}
