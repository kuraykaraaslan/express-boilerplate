import { z } from 'zod';
import { AuditActorTypeEnum, AuditSeverityEnum } from './audit_log.enums';

export const AuditLogSchema = z.object({
  auditLogId:        z.string().uuid(),
  tenantId:          z.string().uuid(),
  actorId:           z.string().uuid().nullable(),
  actorType:         AuditActorTypeEnum,
  onBehalfOfActorId: z.string().uuid().nullable().optional().default(null),
  actorTenantId:     z.string().uuid().nullable().optional().default(null),
  action:            z.string(),
  severity:          AuditSeverityEnum.default('low'),
  resourceType:      z.string().nullable(),
  resourceId:        z.string().nullable(),
  metadata:          z.record(z.string(), z.unknown()).nullable(),
  ipAddress:         z.string().nullable(),
  userAgent:         z.string().nullable(),
  prevHash:          z.string().nullable().optional().default(null),
  rowHash:           z.string().nullable().optional().default(null),
  // Hardened chain (hashVersion 2). Present only on rows that carry them: a legacy row parses to exactly the
  // shape it always had. `actorId` above is resolved from the identity mapping for these rows (null once erased).
  actorRef:          z.string().nullable().optional(),
  onBehalfOfRef:     z.string().nullable().optional(),
  commandJti:        z.string().uuid().nullable().optional(),
  nodeId:            z.string().uuid().nullable().optional(),
  hashVersion:       z.number().int().nullable().optional(),
  createdAt:         z.date(),
});

export type AuditLog = z.infer<typeof AuditLogSchema>;

// Result of a hash-chain verification pass.
export type ChainVerificationResult = {
  ok: boolean;
  // Rows examined: every row that verified, plus the broken one when there is one.
  checked: number;
  // auditLogId of the first row whose stored rowHash does not match the
  // recomputed value (or whose prevHash is broken). Null when ok.
  brokenAt: string | null;
};

// A point in the chain, exact to the microsecond (createdAt travels as text so no client time zone touches it). The
// verifier hands the last verified row back as a position; passing it in resumes the walk right after that row.
export type ChainPosition = {
  createdAt: string;
  auditLogId: string;
  rowHash: string | null;
};

// What the verifier knows beyond the verdict: how far it got. `through` is the last row that verified (null when none
// did), the cursor an incremental job stores and resumes from.
export type ChainVerificationDetail = ChainVerificationResult & {
  through: ChainPosition | null;
  /** True when the walk met a keyed JavaScript row (audit_log.02). */
  keyed?: boolean;
  /** With `headHash`: how many legacy-writer rows (hashVersion NULL) the walk had verified when it reached the row carrying that hash; null when it never did. */
  headAtLegacyRow?: number | null;
};

// Pluggable cold-storage exporter seam (archive-before-delete / write-once
// store). Implementations may push to S3, GCS, a log aggregator, etc. The
// audit module never hard-depends on any of them — purgeExpired() accepts an
// optional exporter and falls back to returning the serialized batch.
export interface AuditArchiveExporter {
  export(tenantId: string, ndjson: string, rowCount: number): Promise<void>;
}
