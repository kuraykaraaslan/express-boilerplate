import { z } from 'zod';
import { CHECK_ID_RE, MAX_CHECKS_PER_COMMAND } from './compliance.wire';
import { MIGRATION_STEP_PAYLOADS } from './migration-step';
import { IsoSecondsSchema } from './attest.schema';
import { SOURCE_PURGE_OPTIONAL, sourcePurgeFieldsConsistent } from './migration-purge';
import { FleetIdRpPublicJwkSchema, isExactHttpsUri } from './fleet-id';

/**
 * Closed command catalogue (docs/phases/02-fleet/02-components-and-data-model/02-...md §4).
 * Adding a kind means adding it here AND to the doc table; the closure test fails otherwise.
 * There is deliberately no entry for data.read / db.query / logs.tail / shell.exec / container.inspect.
 */
export type CommandClass = 0 | 1 | 2 | 3;

const id = z.string().min(1).max(128);
const uuid = z.uuid();
const empty = z.object({}).strict();
const reason = z.string().min(1).max(500);
/** A legal hold's reason, as the node takes it (`tenant.legal-hold.ts` cleanReason): 2 to 500 characters after trimming. Not transformed: the payload is signed as sent. */
const holdReason = z.string().max(500).refine((s) => s.trim().length >= 2, 'at least 2 characters after trimming');
/** A node id as the control plane issues it (`NODE_ID_RE` of fleet.node.service). */
const nodeIdRef = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/**
 * sha256 (hex) of a release's canonical manifest (`manifestHash` of `release.signed.ts`). `release.deploy` and `release.rollback` carry it
 * next to the release id (decision 19): the command is signed by the control plane command key, so the signature binds the id to the
 * CONTENT, and the node's helper refuses a release whose manifest hashes to anything else. Required: a payload without it is refused.
 */
export const ManifestHashSchema = z.string().regex(/^[a-f0-9]{64}$/);

/**
 * How ONE node switches to a release (matches `fleet_deployments.strategy`). The rollout SHAPE across nodes (waves, canary, all at
 * once) belongs to the rollout plan on the control plane, never to the command a node receives.
 */
export const DEPLOY_STRATEGIES = ['BLUE_GREEN', 'RECREATE'] as const;

/** `agent.update` is class 2 only this long after a release was published (04 section 8.4); before it, class 3. */
export const AGENT_UPDATE_COOLING_SECONDS = 24 * 3600;

/**
 * Whether the cooling period has passed (unix seconds). The control plane derives `coolingPeriodElapsed` from this, never from
 * the operator's request, and the node re-checks it. Fails closed: a non-integer or a start in the future is "not elapsed".
 */
export function isCoolingPeriodElapsed(publishedAt: number, now: number): boolean {
  return Number.isSafeInteger(publishedAt) && Number.isSafeInteger(now) && publishedAt <= now && now - publishedAt >= AGENT_UPDATE_COOLING_SECONDS;
}

export const SERVICES = ['runner', 'worker', 'ws', 'telephony-gateway', 'plugin-host', 'caddy'] as const;

interface Def {
  /** Static class, or a function of the payload for kinds whose class depends on it. */
  cls: CommandClass | ((p: Record<string, unknown>) => CommandClass);
  schema: z.ZodType;
}

const tenantRef = z.object({ tenantId: uuid, reason: reason.optional() }).strict();

export const COMMANDS = {
  'node.ping': { cls: 0, schema: z.object({ n: z.number().int().optional() }).strict() },
  'node.inventory': { cls: 0, schema: empty },
  'node.time_sync': { cls: 0, schema: empty },
  'telemetry.snapshot': { cls: 0, schema: empty },
  'config.read': { cls: 1, schema: z.object({ keys: z.array(id).max(200) }).strict() },
  'service.restart': {
    cls: (p) => (p.service === 'caddy' ? 2 : 1),
    schema: z.object({ service: z.enum(SERVICES) }).strict(),
  },
  'queue.pause': { cls: 1, schema: z.object({ queue: id }).strict() },
  'queue.resume': { cls: 1, schema: z.object({ queue: id }).strict() },
  'flag.set': {
    cls: 1,
    schema: z.object({ key: id, value: z.union([z.boolean(), z.number().int(), z.string().max(256)]), rolloutPercentage: z.number().int().min(0).max(100).optional() }).strict(),
  },
  'maintenance.open': {
    cls: (p) => (p.scope === 'SYSTEM' && p.mode === 'FULL' ? 2 : 1),
    schema: z.object({ scope: z.enum(['SYSTEM', 'TENANT']), mode: z.enum(['FULL', 'READ_ONLY']), reason }).strict(),
  },
  'maintenance.close': { cls: 1, schema: z.object({ windowId: uuid.optional() }).strict() },
  'cert.renew': { cls: 1, schema: z.object({ csr: z.string().min(1).max(8192) }).strict() },
  // Agent computes the loosening diff; the control plane may only pre-declare it, never downgrade.
  'policy.apply': {
    cls: (p) => (p.loosens ? 3 : 1),
    schema: z.object({ bundleVersion: z.number().int().positive(), loosens: z.boolean() }).strict(),
  },
  'trust.update': { cls: 1, schema: z.object({ bundleVersion: z.number().int().positive() }).strict() },
  'breakglass.revoke': { cls: 1, schema: z.object({ grantId: uuid }).strict() },
  'release.deploy': {
    cls: 2,
    schema: z.object({ releaseId: uuid, manifestHash: ManifestHashSchema, strategy: z.enum(DEPLOY_STRATEGIES), healthGate: id.optional() }).strict(),
  },
  /** `manifestHash` is the hash of the manifest of `fromReleaseId`, the release being rolled back FROM. */
  'release.rollback': { cls: 2, schema: z.object({ fromReleaseId: uuid, manifestHash: ManifestHashSchema }).strict() },
  'config.set': { cls: 2, schema: z.object({ key: id, value: z.union([z.boolean(), z.number().int(), z.string().max(1024)]) }).strict() },
  'module.allowlist': { cls: 2, schema: z.object({ allow: z.array(id).max(500), deny: z.array(id).max(500) }).strict() },
  'tenant.provision': {
    cls: 2,
    schema: z.object({ tenantId: uuid, homeRegionId: id, plan: id, sealedInit: z.string().min(1) }).strict(),
  },
  'tenant.suspend': { cls: 2, schema: tenantRef.required({ reason: true }) },
  'tenant.resume': { cls: 2, schema: tenantRef },
  /**
   * Legal hold (decision F19, tighten-only): `tenant.hold.set` places or EXTENDS a hold until `until` (the node refuses a shorter date than the hold
   * already in force); lifting one early is `tenant.hold.clear`, class 3, or the node-local authority that set it. The reason is the order's reference:
   * it travels in clear in the signed command, so the control plane keeps it with the command (envelope and `reason` column, shown on the Commands
   * pages); only the node's LEGAL_HOLD_SET / LEGAL_HOLD_CLEARED receipts, which the directory mirrors, carry its hash instead.
   */
  'tenant.hold.set': { cls: 2, schema: z.object({ tenantId: uuid, until: IsoSecondsSchema, reason: holdReason }).strict() },
  'tenant.hold.clear': { cls: 3, schema: z.object({ tenantId: uuid, reason: holdReason }).strict() },
  /**
   * `tenantId` and `rootId` are optional and only mean something to the check `audit.chain_proof` (the node answers with the Merkle path of that tenant's chain head in the
   * acknowledged root `rootId`, or in the newest acknowledged one when `rootId` is absent). They hold ids, which the directory already shares with the node. A command
   * without them stays valid, so an older control plane and an older node keep working.
   */
  'compliance.check': {
    cls: 2,
    schema: z.object({
      // Catalogue ids, each once: the answer is positional (`compliance.wire.ts`), so a duplicate or an id the catalogue cannot hold has no meaning.
      checkIds: z.array(z.string().regex(CHECK_ID_RE)).min(1).max(MAX_CHECKS_PER_COMMAND).refine((a) => new Set(a).size === a.length, 'duplicate check id'),
      tenantId: uuid.optional(), rootId: uuid.optional(),
    }).strict(),
  },
  /**
   * Disaster recovery (decision F1, 07 section 6.1). `node.failover` goes to the paired DR_STANDBY and names the primary that failed (`failedNodeId`): the
   * standby promotes its copy and takes over exactly that primary's tenants. `node.failback` goes to the original primary once it is resynced from the
   * standby and names the standby (`standbyNodeId`) it takes its tenants back from. Both are class 3 and co-signed; the directory moves a tenant only
   * for a receipt that names the command (`fleet_directory.receipts.ts`). The control plane issues them only through the DR routes, never the generic
   * command route. The regional fallback is a document of its own (`failover-order.ts`), not a command.
   */
  'node.failover': { cls: 3, schema: z.object({ reason, failedNodeId: nodeIdRef }).strict() },
  'node.failback': { cls: 3, schema: z.object({ reason, standbyNodeId: nodeIdRef }).strict() },
  /** `manifestHash` binds the release id to its content exactly like `release.deploy` (decision 30): the helper refuses a fetched release that hashes to anything else. */
  'agent.update': {
    cls: (p) => (p.coolingPeriodElapsed ? 2 : 3),
    schema: z.object({ releaseId: uuid, manifestHash: ManifestHashSchema, coolingPeriodElapsed: z.boolean() }).strict(),
  },
  'secret.rotate': {
    cls: 3,
    schema: z.object({ secretRef: id, strategy: z.enum(['generate', 'from-store']) }).strict(),
  },
  'tenant.export': { cls: 3, schema: tenantRef },
  // Each step embeds the migration contract and its hash (migration-step.ts); its approvals answer the CONTRACT hash, one set for the whole migration.
  'tenant.migrate.preflight': { cls: 3, schema: MIGRATION_STEP_PAYLOADS['tenant.migrate.preflight'] },
  'tenant.migrate.seal_names': { cls: 3, schema: MIGRATION_STEP_PAYLOADS['tenant.migrate.seal_names'] },
  'tenant.migrate.check_names': { cls: 3, schema: MIGRATION_STEP_PAYLOADS['tenant.migrate.check_names'] },
  'tenant.migrate.export': { cls: 3, schema: MIGRATION_STEP_PAYLOADS['tenant.migrate.export'] },
  'tenant.migrate.import': { cls: 3, schema: MIGRATION_STEP_PAYLOADS['tenant.migrate.import'] },
  'tenant.migrate.cutover': { cls: 3, schema: MIGRATION_STEP_PAYLOADS['tenant.migrate.cutover'] },
  'tenant.migrate.abort': { cls: 3, schema: MIGRATION_STEP_PAYLOADS['tenant.migrate.abort'] },
  'tenant.migrate.rollback': { cls: 3, schema: MIGRATION_STEP_PAYLOADS['tenant.migrate.rollback'] },
  'tenant.delete': { cls: 3, schema: tenantRef.extend({ graceDays: z.number().int().min(7).max(90).optional() }) },
  /**
   * The deletion purge of a tenant awaiting deletion, or, with `migrationId`, `importReceipt` and `targetSigningPublicKey` (all three or none), the purge of a
   * migrated tenant's SOURCE copy after the source retention (05 section 6.2 COMPLETED, `migration-purge.ts`): own approvals, never the contract's.
   */
  'tenant.purge': { cls: 3, schema: tenantRef.extend(SOURCE_PURGE_OPTIONAL).refine(sourcePurgeFieldsConsistent, 'a source purge needs migrationId, importReceipt and targetSigningPublicKey together') },
  'tenant.restore': { cls: 3, schema: tenantRef },
  'diagnostics.bundle': {
    cls: 3,
    schema: z.object({ fromTs: z.number().int().nonnegative(), toTs: z.number().int().nonnegative(), reason }).strict(),
  },
  'breakglass.grant': {
    cls: 3,
    schema: z
      .object({
        requesterPublicKey: z.string().min(1).max(256),
        operatorRef: id,
        windowSeconds: z.number().int().positive().max(4 * 3600),
        scope: id,
        legalOrderRef: id.optional(),
        /** Defers the TENANT notification (never the regional one) by 1..90 days; only meaningful with a `legalOrderRef`. */
        notifyAfterDays: z.number().int().min(1).max(90).optional(),
      })
      .strict(),
  },
  'identity.client.register': {
    cls: 2,
    // https only: a bare z.url() also takes javascript:, data: and file: redirects.
    // rpJwk: the PUBLIC JWK of the node's dedicated RP key (F12), as the node reported it in its heartbeat (`fleetIdClient`); a private member is
    // not representable. backchannelLogoutUri: where the hub pushes logout tokens, the same exact https rule as the node's report.
    schema: z.object({ clientId: id, redirectUris: z.array(z.url({ protocol: /^https$/ })).min(1).max(20), rpJwk: FleetIdRpPublicJwkSchema, backchannelLogoutUri: z.string().refine(isExactHttpsUri, 'not an exact https URI').optional() }).strict(),
  },
  'identity.erase_fanout': { cls: 3, schema: z.object({ sub: id }).strict() },
  'identity.dossier_fanout': { cls: 3, schema: z.object({ sub: id }).strict() },
  // Class 2, decision F28 (2026-10-20): the person's own authenticated erasure request at the hub stands in for the operators' approval; it is
  // issued only inside a fan-out (`planEraseFanout`), never by hand. An operator-started fan-out stays `identity.erase_fanout`, class 3.
  'user.erase': { cls: 2, schema: z.object({ sub: id, fanoutJti: uuid }).strict() },
  // Class 2 as well (decision F37, 2026-10-21): the person's own authenticated request at the hub is the approval of an ACCESS request. The node does not
  // return data: it opens a verified portability request in each of the person's workspaces on it, which that workspace's data protection officer fulfils
  // in-region (decision F13: dossiers stay on the node). Issued only inside a fan-out (`planDossierFanout`); an operator-started one stays `identity.dossier_fanout`.
  'user.dossier': { cls: 2, schema: z.object({ sub: id, fanoutJti: uuid }).strict() },
  'node.suspend': { cls: 3, schema: z.object({ reason }).strict() },
  'node.resume': { cls: 3, schema: z.object({ reason }).strict() },
  'node.decommission': { cls: 3, schema: z.object({ reason }).strict() },
  'node.destroy_confirm': { cls: 3, schema: z.object({ receiptHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict() },
} satisfies Record<string, Def>;

export type CommandKind = keyof typeof COMMANDS;
export const COMMAND_KINDS = Object.keys(COMMANDS) as CommandKind[];

/** Kinds that must never exist (class 4). Kept for the closure test and for readable rejections. */
export const FORBIDDEN_KINDS = ['data.read', 'db.query', 'logs.tail', 'shell.exec', 'container.inspect'] as const;

/**
 * Kinds that run on the node-side agent/app only, except these two, which are recorded control-plane side and never queued for a node:
 * `node.destroy_confirm`, and `identity.client.register` (FID-06, decision F29: the hub and the control plane are one deployment, so the operator's
 * acceptance of a node's reported client is a local write and an audit row, not a message to the node).
 */
export const CP_ONLY_KINDS: readonly CommandKind[] = ['node.destroy_confirm', 'identity.client.register'];

export function isCommandKind(kind: unknown): kind is CommandKind {
  return typeof kind === 'string' && Object.prototype.hasOwnProperty.call(COMMANDS, kind);
}

export type CommandCheck =
  | { ok: true; kind: CommandKind; cls: CommandClass; payload: Record<string, unknown> }
  | { ok: false; reason: 'unknown_kind' | 'bad_payload' };

/** Envelope rule 7: kind in catalogue, payload matches the kind's strict schema, class derived from kind+payload. */
export function checkCommandBody(body: unknown): CommandCheck {
  if (typeof body !== 'object' || body === null) return { ok: false, reason: 'unknown_kind' };
  const { kind, ...payload } = body as Record<string, unknown>;
  if (!isCommandKind(kind)) return { ok: false, reason: 'unknown_kind' };
  const def: Def = COMMANDS[kind];
  const parsed = def.schema.safeParse(payload);
  if (!parsed.success) return { ok: false, reason: 'bad_payload' };
  const cls = typeof def.cls === 'function' ? def.cls(parsed.data as Record<string, unknown>) : def.cls;
  return { ok: true, kind, cls, payload: parsed.data as Record<string, unknown> };
}

/** Worst-case class of a kind (used for gating and the doc-table comparison). */
export function maxClass(kind: CommandKind): CommandClass {
  const c = COMMANDS[kind].cls as CommandClass | ((p: Record<string, unknown>) => CommandClass);
  return typeof c === 'function' ? (Math.max(c({ service: 'caddy', scope: 'SYSTEM', mode: 'FULL' }), c({ loosens: true }), c({ coolingPeriodElapsed: false })) as CommandClass) : c;
}

/** Legal hold orders (decision F19): they change no tenant data, only what may happen to it, so they are never serialised behind a running purge or migration. */
const LEGAL_HOLD_KINDS: readonly string[] = ['tenant.hold.set', 'tenant.hold.clear'];
/**
 * A migration's names check (05 section 6.2 NAMES): the source seals the tenant's names, the target compares them with its own; neither writes anything,
 * so neither waits behind another tenant's long export or purge on the same node (it would expire queued, and hold the migration in PREFLIGHT for nothing).
 */
const NAMES_CHECK_KINDS: readonly string[] = ['tenant.migrate.seal_names', 'tenant.migrate.check_names'];

/**
 * Kinds that mutate tenant data or node configuration: the control plane serialises them per node (03 §4 "Ordering") so a
 * second one never starts while the first is unfinished. Everything else (restart, rollback, maintenance, node.*, class 0/1)
 * is never blocked, so a stuck purge cannot hold a rollback hostage. The legal hold kinds are not data-mutating either: a 12 h
 * migration or a 24 h purge of another tenant would otherwise keep a hold order QUEUED past its 1 h class-2 TTL, and it would
 * never be delivered (the node takes the hold under the tenant row lock, so it needs no CP ordering).
 */
export function isDataMutatingKind(kind: string): boolean {
  if (LEGAL_HOLD_KINDS.includes(kind) || NAMES_CHECK_KINDS.includes(kind)) return false;
  return kind.startsWith('tenant.') || ['release.deploy', 'config.set', 'module.allowlist', 'secret.rotate', 'policy.apply'].includes(kind);
}

/** How long after `exp` a started command may still report before the control plane marks it UNKNOWN (03 §4 "Timeouts"). */
export function execTimeoutSeconds(kind: string): number {
  if (kind === 'service.restart') return 2 * 60;
  if (kind === 'release.deploy' || kind === 'release.rollback') return 30 * 60;
  if (kind === 'tenant.migrate.export' || kind === 'tenant.migrate.import') return 12 * 3600;
  if (kind === 'tenant.purge' || kind === 'tenant.delete' || kind === 'tenant.export') return 24 * 3600;
  return 10 * 60;
}
