import { z } from 'zod';
import { SERVICES, DEPLOY_STRATEGIES, ManifestHashSchema, type CommandKind } from './catalogue';
import { GResultSchema } from './g.schema';

/**
 * Wire protocol between the agent and `fleet-deployd` (the root host helper) on `/run/fleet-deployd.sock`
 * (docs/phases/02-fleet 02 section 2.2, 03 section 1 C5, 07 section 2).
 *
 * The verb set is CLOSED and every field is a uuid, an enum or a boolean: nothing in a request can carry a path, a command line, an
 * image reference, a registry or a Compose fragment. What to run comes from the doubly-signed release the helper verifies itself
 * (by `releaseId`, from the agent's cache), and a `promote` from the signed DR authority the helper verifies itself (by `jti`, from the agent's
 * keys directory); the agent only names WHICH release and WHICH of a fixed set of operations, and proves it is
 * the agent with the capability token. `migrate`, `deploy`, `rollback` and `update-agent` also carry the `manifestHash` the control plane signed into
 * the command (decision 19): the helper refuses a release whose own manifest hashes to anything else. There is
 * deliberately no verb for inspect, logs, exec, pull-by-reference or free-form container specs.
 *
 * Framing: one NDJSON line per request (at most MAX_DEPLOYD_REQUEST_BYTES) and one line back (at most MAX_DEPLOYD_RESPONSE_BYTES),
 * then the connection closes. The response is `G`-shaped: result code, bounded counts, hashes, plus closed enums for the phase
 * reached and the reason; no free text.
 */
export const DEPLOYD_PROTOCOL_VERSION = 1;
export const MAX_DEPLOYD_REQUEST_BYTES = 1024;
export const MAX_DEPLOYD_RESPONSE_BYTES = 8192;
/**
 * The file the helper publishes next to its token at every start (decision F21): the regional release pins it enforces, `{"v":1,"approvedReleases":[...]|null}`,
 * for the agent to report in its heartbeat. Outside the socket protocol on purpose (no new verb or response field, so an agent and a helper of different
 * versions still understand each other); a report, never an input: the helper admits from its own root-owned config.
 */
export const DEPLOYD_RELEASE_PINS_FILE = 'release-pins.json';
/**
 * The file the helper publishes next to its token whenever `ps` read the node's backup report (P8-BACKUP; `infra/compose/backup`): where each
 * pgBackRest repository is, for the agent's `backup.location_in_region` judge. A host name is not something the closed `ps` answer can carry, so it
 * travels here, bound to the answer by `reportAt` (the report's own time, also `BACKUP_REPORT_AT` of the counts). A report, never an input; removed
 * when the helper has no readable report.
 */
export const DEPLOYD_BACKUP_LOCATION_FILE = 'backup-location.json';
/** pgBackRest repository types (`repoN-type`). Only object storage is a remote repository; `posix`, `sftp` and `cifs` are paths on some host. */
export const BACKUP_REPO_TYPES = ['s3', 'azure', 'gcs', 'posix', 'sftp', 'cifs'] as const;
export type BackupRepoType = (typeof BACKUP_REPO_TYPES)[number];
export const BACKUP_REMOTE_REPO_TYPES: readonly BackupRepoType[] = ['s3', 'azure', 'gcs'];
/** A host name with an optional port, lower case: the closed pattern `fleet-backup` checks the endpoint against before it reports it. */
export const BACKUP_ENDPOINT_RE = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?(:[0-9]{1,5})?$/;
export const BACKUP_REGION_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const BACKUP_BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
export const BackupRepoLocationSchema = z.object({
  repo: z.number().int().min(1).max(4),
  type: z.enum(BACKUP_REPO_TYPES),
  /** null: not configured, or outside the closed pattern (never passed on). */
  endpoint: z.string().regex(BACKUP_ENDPOINT_RE).nullable(),
  region: z.string().regex(BACKUP_REGION_RE).nullable(),
  bucket: z.string().regex(BACKUP_BUCKET_RE).nullable(),
}).strict();
export type BackupRepoLocation = z.infer<typeof BackupRepoLocationSchema>;
export const BackupLocationFileSchema = z.object({
  v: z.literal(1),
  /** Unix seconds: when `fleet-backup` wrote the report this was read from. */
  reportAt: z.number().int().positive().max(2 ** 40),
  repos: z.array(BackupRepoLocationSchema).max(4),
}).strict();
export type BackupLocationFile = z.infer<typeof BackupLocationFileSchema>;
/**
 * The `counts` keys of a `ps` answer that carry the node's backup report (P8-BACKUP), next to `BACKUP_CONFIGURED` / `BACKUP_LAST_AT` /
 * `BACKUP_UNREADABLE` of the helper's own pre-deploy record. All absent when there is no report; `reportUnreadable` = 1 when there is one the helper
 * could not trust or parse (never said as "no backup"). `BACKUP_LAST_AT` is the later of the two sources. A number the report does not give
 * (the newest backup's size, the noncurrent-version horizon) is absent, never zero.
 */
export const DEPLOYD_BACKUP_COUNTS = {
  reportAt: 'BACKUP_REPORT_AT',
  reportUnreadable: 'BACKUP_REPORT_UNREADABLE',
  lastRunOk: 'BACKUP_LAST_RUN_OK',
  stanzaOk: 'BACKUP_STANZA_OK',
  count: 'BACKUP_COUNT',
  fullCount: 'BACKUP_FULL_COUNT',
  newestAt: 'BACKUP_NEWEST_AT',
  newestBytes: 'BACKUP_NEWEST_BYTES',
  oldestAt: 'BACKUP_OLDEST_AT',
  reposRemote: 'BACKUP_REPOS_REMOTE',
  reposLocal: 'BACKUP_REPOS_LOCAL',
  reposUnknown: 'BACKUP_REPOS_UNKNOWN',
  pitrDays: 'BACKUP_PITR_DAYS',
  noncurrentDays: 'BACKUP_NONCURRENT_DAYS',
} as const;
/**
 * The directory, inside the agent's keys directory, where the agent leaves the signed authority of a `promote` (`<jti>.json`: the class-3 envelope, or the
 * `{ order, signature }` of a regional order) for the helper to read and verify. Untrusted input, read with the release-cache rules; at most
 * `MAX_DR_AUTHORITY_BYTES`. The authority never travels on the socket: the request stays uuids and enums.
 */
export const DEPLOYD_DR_AUTHORITY_DIR = 'dr-authority';
export const MAX_DR_AUTHORITY_BYTES = 64 * 1024;
/** What a `promote` request says its authority is: a co-signed class-3 DR command, or a regional operator's failover order. */
export const DEPLOYD_PROMOTE_AUTHORITIES = ['COMMAND', 'REGIONAL_ORDER'] as const;
export type DeploydPromoteAuthority = (typeof DEPLOYD_PROMOTE_AUTHORITIES)[number];

/** Every verb the helper understands. Adding one means adding it here, to the schema below, and to the doc table (closure test). */
export const DEPLOYD_VERBS = ['migrate', 'deploy', 'rollback', 'restart', 'update-agent', 'promote', 'ps', 'status'] as const;
export type DeploydVerb = (typeof DEPLOYD_VERBS)[number];

const uuid = z.uuid();

/**
 * Per-boot capability token (04 section 1.1): 32 random bytes, base64url. The helper generates it at start and writes it to a file only
 * the agent user can read; the agent copies it into every request. It is a secret: never log a request unredacted. The fixed length
 * and charset mean it cannot carry a path or a command either.
 */
export const DEPLOYD_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/**
 * `jti` = the originating command's jti. The helper journals each operation under `(jti, verb)`, because `release.deploy` sends
 * `migrate` and `deploy` under ONE jti: a replayed `migrate` must not make the following `deploy` look like a duplicate. `status`
 * names the jti and answers for the LAST verb journaled under it. Read-only verbs carry a fresh uuid.
 */
const verb = <V extends DeploydVerb, S extends z.ZodRawShape>(name: V, shape: S) =>
  z.object({ v: z.literal(DEPLOYD_PROTOCOL_VERSION), jti: uuid, token: z.string().regex(DEPLOYD_TOKEN_RE), verb: z.literal(name), ...shape }).strict();

export const DeploydRequestSchema = z.discriminatedUnion('verb', [
  /** Run the release's checksummed migrations against the node database with the release's migrate image (contract steps need a maintenance window and a backup). */
  verb('migrate', { releaseId: uuid, manifestHash: ManifestHashSchema }),
  /** Verify, pull by digest, render, start the new stack, health-check, switch, bake, stop the old one. The helper picks the target color. */
  verb('deploy', { releaseId: uuid, manifestHash: ManifestHashSchema, strategy: z.enum(DEPLOY_STRATEGIES) }),
  /** Roll back FROM `fromReleaseId` (whose manifest hashes to `manifestHash`) to the previous release; refused unless it is the current one. */
  verb('rollback', { fromReleaseId: uuid, manifestHash: ManifestHashSchema }),
  verb('restart', { service: z.enum(SERVICES) }),
  /** `manifestHash` as for `deploy` (decision 30); `coolingPeriodElapsed` mirrors the command payload and the helper re-checks it against the release's own signing time. */
  verb('update-agent', { releaseId: uuid, manifestHash: ManifestHashSchema, coolingPeriodElapsed: z.boolean() }),
  /**
   * Promote the node's database from a replica to the primary (decision F1: the first step of a DR `node.failover` on the paired standby or of a
   * `node.failback` on the resynced primary; shared with P8-HA). WHAT runs is the root-owned config's `dr.promoteCommand`, never the agent's. WHEN it
   * runs is decided by a signed authority the helper verifies itself, like a release: `jti` is the authority's own id (the command's jti, or the
   * regional order's `orderId`), `authority` says which kind it is, and the agent leaves the signed document in its keys directory
   * (`<keysDir>/DEPLOYD_DR_AUTHORITY_DIR/<jti>.json`, untrusted input, like the release cache). The helper verifies a co-signed class-3 `node.failover` /
   * `node.failback` envelope against its OWN trust bundle (rooted in its root-owned pin: command key, two distinct co-signers of the bundle's cosign
   * section), or a regional failover order against the regional operator key pinned in its root-owned config; the authority must name this node, be
   * inside its validity window, and is used once (journaled by id until it expires). Anything else is PROMOTE_UNAUTHORIZED and nothing runs.
   * NOOP when the database already is the primary, so a retried takeover is safe.
   */
  verb('promote', { authority: z.enum(DEPLOYD_PROMOTE_AUTHORITIES) }),
  /** Structured state of the stack. Read-only. */
  verb('ps', {}),
  /** State of the journaled operation `operationJti` (how a restarted agent learns what happened). Read-only. */
  verb('status', { operationJti: uuid }),
]);
export type DeploydRequest = z.infer<typeof DeploydRequestSchema>;

export const DEPLOYD_PHASES = [
  'ACCEPT', 'VERIFY', 'PULL', 'RENDER', 'MIGRATE', 'START', 'HEALTH', 'SWITCH', 'BAKE', 'CLEANUP', 'ROLLBACK', 'RESTART', 'AGENT_UPDATE', 'WATCHDOG', 'PROMOTE', 'DONE',
] as const;
export type DeploydPhase = (typeof DEPLOYD_PHASES)[number];

export const DEPLOYD_REASONS = [
  'BAD_REQUEST', 'UNKNOWN_VERB', 'TOO_LARGE', 'PEER_DENIED', 'BUSY', 'UNSUPPORTED',
  'RELEASE_NOT_FOUND', 'RELEASE_UNVERIFIED', 'RELEASE_NOT_ADMITTED', 'TEMPLATE_UNKNOWN', 'DIGEST_MISMATCH', 'PULL_FAILED',
  'MIGRATION_REFUSED', 'MIGRATION_FAILED', 'HEALTH_FAILED', 'SWITCH_FAILED',
  'ROLLBACK_REFUSED', 'NOT_CURRENT_RELEASE', 'COOLING_PERIOD', 'ALREADY_CURRENT', 'TIMEOUT', 'INTERNAL', 'PROMOTE_FAILED', 'PROMOTE_UNAUTHORIZED',
] as const;
export type DeploydReason = (typeof DEPLOYD_REASONS)[number];

/**
 * The `counts` keys of a `ps` answer that carry what the helper measured about the serving release (decision 29): the node-side health
 * source of the rollout gates. They ride in the answer's bounded counts, so the closed response schema is unchanged and an agent that does
 * not know them ignores them. A number the helper has no source for is ABSENT (never zero), and there is no key for `queueFailed`:
 * the helper does not see the queues; the node app supplies it (`queue_failed_jobs` of its G metrics, X4-6).
 */
export const DEPLOYD_HEALTH_COUNTS = {
  errorRatePermille: 'HEALTH_ERROR_RATE_PERMILLE',
  p95Ms: 'HEALTH_P95_MS',
  unhealthy: 'HEALTH_UNHEALTHY',
} as const;

export const DEPLOYD_COLORS = ['blue', 'green'] as const;
export const SERVICE_STATES = ['RUNNING', 'UNHEALTHY', 'RESTARTING', 'EXITED', 'MISSING'] as const;
export const OPERATION_STATES = ['NOT_FOUND', 'RUNNING', 'SUCCEEDED', 'FAILED'] as const;

const OK_CODES: readonly string[] = ['OK', 'NOOP'];

export const DeploydResponseSchema = GResultSchema.extend({
  v: z.literal(DEPLOYD_PROTOCOL_VERSION),
  /** Echo of the request `jti` (the nil uuid when the request was too malformed to carry one). */
  jti: uuid,
  verb: z.enum(DEPLOYD_VERBS).optional(),
  /** The phase the operation ended in: where it stopped on a failure, DONE on success. */
  phase: z.enum(DEPLOYD_PHASES),
  /** Why a non-OK code; absent for OK and NOOP. */
  reason: z.enum(DEPLOYD_REASONS).optional(),
  /** `ps` and `deploy`: the release currently serving and its color. */
  releaseId: uuid.optional(),
  color: z.enum(DEPLOYD_COLORS).optional(),
  /** `ps` only. */
  services: z.array(z.object({ service: z.enum(SERVICES), color: z.enum(DEPLOYD_COLORS).optional(), state: z.enum(SERVICE_STATES) }).strict()).max(32).optional(),
  /** `status` only. */
  operation: z.enum(OPERATION_STATES).optional(),
}).strict().superRefine((r, ctx) => {
  if (OK_CODES.includes(r.code) !== (r.reason === undefined)) {
    ctx.addIssue({ code: 'custom', path: ['reason'], message: 'reason is present exactly when the code is not OK or NOOP' });
  }
});
export type DeploydResponse = z.infer<typeof DeploydResponseSchema>;

export const NIL_JTI = '00000000-0000-0000-0000-000000000000';

const VERB_SET: ReadonlySet<string> = new Set(DEPLOYD_VERBS);

export type DeploydRequestParse =
  | { ok: true; request: DeploydRequest }
  | { ok: false; reason: 'TOO_LARGE' | 'BAD_REQUEST' | 'UNKNOWN_VERB'; jti: string };

type Frame = { kind: 'ok'; text: string } | { kind: 'too_large' } | { kind: 'bad' };

function frame(line: string | Uint8Array, maxBytes: number): Frame {
  const bytes = Buffer.from(line);
  if (bytes.length > maxBytes + 2) return { kind: 'too_large' };
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return { kind: 'bad' }; }
  if (text.endsWith('\r\n')) text = text.slice(0, -2);
  else if (text.endsWith('\n')) text = text.slice(0, -1);
  // exactly one frame: an embedded line break would smuggle a second request
  if (/[\r\n]/.test(text)) return { kind: 'bad' };
  return Buffer.byteLength(text, 'utf8') > maxBytes ? { kind: 'too_large' } : { kind: 'ok', text };
}

/**
 * Server side: one request line (with or without its trailing newline) to a verified request, or a closed reason the server
 * answers with. An unknown verb is told apart from a malformed request so the reply names it; both are refusals.
 */
export function parseDeploydRequest(line: string | Uint8Array): DeploydRequestParse {
  const framed = frame(line, MAX_DEPLOYD_REQUEST_BYTES);
  if (framed.kind === 'too_large') return { ok: false, reason: 'TOO_LARGE', jti: NIL_JTI };
  if (framed.kind === 'bad') return { ok: false, reason: 'BAD_REQUEST', jti: NIL_JTI };
  let raw: unknown;
  try { raw = JSON.parse(framed.text); } catch { return { ok: false, reason: 'BAD_REQUEST', jti: NIL_JTI }; }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, reason: 'BAD_REQUEST', jti: NIL_JTI };
  const jti = uuid.safeParse((raw as Record<string, unknown>).jti);
  const echo = jti.success ? jti.data : NIL_JTI;
  const name = (raw as Record<string, unknown>).verb;
  if (typeof name === 'string' && !VERB_SET.has(name)) return { ok: false, reason: 'UNKNOWN_VERB', jti: echo };
  const parsed = DeploydRequestSchema.safeParse(raw);
  return parsed.success ? { ok: true, request: parsed.data } : { ok: false, reason: 'BAD_REQUEST', jti: echo };
}

/** Client side: the NDJSON line (with its newline) for a request. Throws (ZodError) on anything the helper would refuse. */
export function encodeDeploydRequest(request: DeploydRequest): string {
  const line = JSON.stringify(DeploydRequestSchema.parse(request));
  if (Buffer.byteLength(line, 'utf8') > MAX_DEPLOYD_REQUEST_BYTES) throw new RangeError('deployd request too large');
  return `${line}\n`;
}

/** Server side: the NDJSON line for a response. Throws (ZodError) on an off-spec response, so a helper bug cannot emit one. */
export function encodeDeploydResponse(response: DeploydResponse): string {
  const line = JSON.stringify(DeploydResponseSchema.parse(response));
  if (Buffer.byteLength(line, 'utf8') > MAX_DEPLOYD_RESPONSE_BYTES) throw new RangeError('deployd response too large');
  return `${line}\n`;
}

export type DeploydResponseParse = { ok: true; response: DeploydResponse } | { ok: false };

/** Client side: anything off-schema, oversized or not a single line is `ok: false` (the driver reports FAILED, never trusts it). */
export function parseDeploydResponse(line: string | Uint8Array): DeploydResponseParse {
  const framed = frame(line, MAX_DEPLOYD_RESPONSE_BYTES);
  if (framed.kind !== 'ok') return { ok: false };
  try {
    const parsed = DeploydResponseSchema.safeParse(JSON.parse(framed.text));
    return parsed.success ? { ok: true, response: parsed.data } : { ok: false };
  } catch { return { ok: false }; }
}

/**
 * Catalogue kinds served by the helper and the verb sequence each one becomes (the agent sends them in order, stopping at the first
 * non-OK response). `release.deploy` migrates first, while the current stack keeps serving (the N-1 contract makes that safe), then
 * switches. Everything else is a single verb.
 */
export const DEPLOYD_KIND_VERBS = {
  'release.deploy': ['migrate', 'deploy'],
  'release.rollback': ['rollback'],
  'service.restart': ['restart'],
  'agent.update': ['update-agent'],
} as const satisfies Partial<Record<CommandKind, readonly DeploydVerb[]>>;
export type DeploydKind = keyof typeof DEPLOYD_KIND_VERBS;

/**
 * Verbs the agent calls on its own account (heartbeat/compliance state, result handoff), not as the execution of a command kind; and `promote`, the
 * first step of the composite DR executors (`node.failover` / `node.failback` are the helper's promote THEN the app's takeover, `agent.dr.ts`).
 */
export const DEPLOYD_DIRECT_VERBS = ['ps', 'status', 'promote'] as const satisfies readonly DeploydVerb[];

export function isDeploydKind(kind: string): kind is DeploydKind {
  return Object.prototype.hasOwnProperty.call(DEPLOYD_KIND_VERBS, kind);
}

/**
 * The requests for an already verified command: `payload` is the catalogue payload of `kind` (`checkCommandBody`), `jti` the
 * command's jti, `token` the helper's capability token. Throws (ZodError) when the payload does not carry what a verb needs, so a
 * mismatch between catalogue and verbs surfaces here instead of on the wire.
 */
export function deploydRequestsFor(kind: DeploydKind, payload: Record<string, unknown>, jti: string, token: string): DeploydRequest[] {
  const base = { v: DEPLOYD_PROTOCOL_VERSION, jti, token } as const;
  switch (kind) {
    case 'release.deploy':
      return [
        DeploydRequestSchema.parse({ ...base, verb: 'migrate', releaseId: payload.releaseId, manifestHash: payload.manifestHash }),
        DeploydRequestSchema.parse({ ...base, verb: 'deploy', releaseId: payload.releaseId, manifestHash: payload.manifestHash, strategy: payload.strategy }),
      ];
    case 'release.rollback':
      return [DeploydRequestSchema.parse({ ...base, verb: 'rollback', fromReleaseId: payload.fromReleaseId, manifestHash: payload.manifestHash })];
    case 'service.restart':
      return [DeploydRequestSchema.parse({ ...base, verb: 'restart', service: payload.service })];
    case 'agent.update':
      return [DeploydRequestSchema.parse({ ...base, verb: 'update-agent', releaseId: payload.releaseId, manifestHash: payload.manifestHash, coolingPeriodElapsed: payload.coolingPeriodElapsed })];
  }
}
