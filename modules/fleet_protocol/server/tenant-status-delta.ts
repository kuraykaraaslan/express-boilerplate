import { z } from 'zod';

/**
 * The `tenantStatusDelta` of a heartbeat acknowledgement (docs/phases/02-fleet/03 section 8.3, decision F1): what the tenant directory changed, since the
 * node's acknowledged cursor, about tenants that live on that node or lived there until the change. One entry per tenant (the newest change), each with
 * the directory's effective status, its `assignmentVersion` and the node that is the tenant's home at that version, so a returning old primary sees that
 * a higher version homes its tenant elsewhere and fences itself (F1). Class G: ids, a status code and integers, never a name, slug, domain or owner.
 *
 * The cursor is an opaque, strictly increasing integer naming a row of the directory's change log (its position and a tag of its content). The node
 * reports the last one it applied in its heartbeat (`tenantStatusCursor`); the acknowledgement answers the changes after it, at most
 * `MAX_TENANT_STATUS_DELTA` entries, and the cursor to report next time. A node that reports none (first heartbeat, lost state, an agent that predates
 * it), or a cursor the directory does not find in its log (a control plane restored from an older backup), starts from the beginning and pages through.
 *
 * The acknowledgement is not signed, so a node only ever takes an entry as a reason to RESTRICT a tenant (fence it, suspend it), never to serve one it
 * does not serve, reactivate one or take a tenant over. Those happen only through signed commands.
 */
export const MAX_TENANT_STATUS_DELTA = 256;
export const MAX_TENANT_STATUS_CURSOR = Number.MAX_SAFE_INTEGER;

/**
 * The statuses an entry can carry: the directory's lifecycle without its UNAVAILABLE overlay (the overlay means "the home node is down", which is not news
 * to that node; an entry carries the status the overlay will clear back to).
 */
export const DELTA_TENANT_STATUSES = ['REGISTERED', 'PROVISIONING', 'ACTIVE', 'SUSPENDED', 'MIGRATING', 'PENDING_DELETION', 'DELETED'] as const;
export type DeltaTenantStatus = (typeof DELTA_TENANT_STATUSES)[number];

export const TenantStatusCursorSchema = z.number().int().min(0).max(MAX_TENANT_STATUS_CURSOR);

export const TenantStatusEntrySchema = z.object({
  tenantId: z.uuid(),
  status: z.enum(DELTA_TENANT_STATUSES),
  assignmentVersion: z.number().int().min(1).max(2 ** 31 - 1),
  homeNodeId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
}).strict();
export type TenantStatusEntry = z.infer<typeof TenantStatusEntrySchema>;

export const TenantStatusDeltaSchema = z.object({
  entries: z.array(TenantStatusEntrySchema).max(MAX_TENANT_STATUS_DELTA),
  cursor: TenantStatusCursorSchema,
}).strict();
export type TenantStatusDelta = z.infer<typeof TenantStatusDeltaSchema>;

/**
 * What a node does with one entry for a tenant it holds, given its own row (pure; the node app applies the verdict):
 *  - `STALE`: the entry is older than what the node already holds (a lower `assignmentVersion`) or names nothing new;
 *  - `FENCE`: a version at least as high as the node's homes the tenant on ANOTHER node, while this node still believes it is the home: the node records
 *    the new home and version, and its routing then refuses the tenant (no write is ever served here again for it);
 *  - `SUSPEND`: the tenant still lives here and the directory has it SUSPENDED while the node serves it ACTIVE (the directory leaves out a suspension
 *    that a signed resume or restore issued after it overtook, so a stale entry never reverses the operator's signed order);
 *  - `IGNORE`: anything else, in particular every entry that would loosen something (a resume, a reactivation, a tenant homed HERE that this node does
 *    not consider its own, a tenant mid-migration or already relocated, whose own signed flow decides).
 */
export type TenantStatusVerdict = 'STALE' | 'FENCE' | 'SUSPEND' | 'IGNORE';

export interface NodeTenantView { tenantStatus: string; homeNodeId: string | null; assignmentVersion: number }

/** Node statuses a delta may restrict; the migration and deletion states belong to their own signed flows. */
const FENCEABLE = new Set(['ACTIVE', 'SUSPENDED', 'INACTIVE', 'PENDING']);

export function tenantStatusVerdict(selfNodeId: string, row: NodeTenantView, entry: TenantStatusEntry): TenantStatusVerdict {
  if (entry.assignmentVersion < row.assignmentVersion) return 'STALE';
  // a tenant this node never considered its own (homed elsewhere already, or never assigned by a directory) is never touched by an unsigned entry
  const homeHere = row.homeNodeId === selfNodeId;
  if (!homeHere) return row.homeNodeId === entry.homeNodeId && entry.assignmentVersion === row.assignmentVersion ? 'STALE' : 'IGNORE';
  if (entry.homeNodeId !== selfNodeId) {
    // a migration's source is frozen and relocated by its signed cutover; only a tenant the node still serves, or holds suspended, is fenced here
    if (!FENCEABLE.has(row.tenantStatus)) return 'IGNORE';
    return entry.assignmentVersion > row.assignmentVersion ? 'FENCE' : 'IGNORE';
  }
  if (entry.status === 'SUSPENDED' && row.tenantStatus === 'ACTIVE') return 'SUSPEND';
  return 'IGNORE';
}
