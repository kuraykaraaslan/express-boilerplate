import 'reflect-metadata'
import { createPublicKey } from 'node:crypto'
import { withTenantRepositoryFor, withTenantTransactionFor } from '@kuraykaraaslan-labs/db'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { ProbeRunner } from './entities/probe_runner.entity'
import { ProbeEnrolment } from './entities/probe_enrolment.entity'
import { ProbeLocation } from './entities/probe_location.entity'
import { BROWSER_CAPABILITY } from './uptime.browser.schema'
import ProbeLocationService from './probe.location.service'
import { auditProbe } from './probe.audit'
import { runnerSkew, type RunnerSkew } from './probe.version'
import {
  generateEnrolmentToken, hashEnrolmentToken, keyFingerprint, looksLikeEnrolmentToken, sha256Hex, verifyRequest, withinSkew,
} from './probe.signing'

/**
 * Runner enrolment, authentication and revocation (observability phase 10.2).
 *
 * Enrolment: a tenant admin mints a single-use token for ONE location (shown once, only its hash stored, expires in an hour); the runner
 * generates its own key pair on its host and sends the PUBLIC half with the token. After that every request is signed, and the control plane
 * holds nothing that could sign for the runner. Every failure on the public endpoints is the same refusal, so they reveal nothing about which
 * runners, tokens or locations exist.
 */
export const ENROLMENT_TTL_MS = 60 * 60_000
export const RUNNER_STALE_MS = 5 * 60_000

const unauthorized = () => new AppError('Unauthorized', 401, ErrorCode.UNAUTHORIZED)
const notFound = () => new AppError('Not found', 404, ErrorCode.NOT_FOUND)

export interface RunnerView {
  runnerId: string; locationId: string; locationKey: string; name: string; fingerprint: string; status: string
  version: string | null; lastSeenAt: Date | null; createdAt: Date; revokedAt: Date | null
  /** What the runner reported it can do (`browser`). */
  capabilities: string[]
  /** Against what the control plane supports (probe.version.ts): the screen says "update" for `outdated`; `unsupported` is refused work. */
  skew: RunnerSkew
}
/** The capabilities this control plane knows. A runner can only claim what is listed here: an unknown name is dropped, never stored. */
export const KNOWN_CAPABILITIES: readonly string[] = [BROWSER_CAPABILITY]
export function normaliseCapabilities(raw: unknown): string[] {
  return Array.isArray(raw) ? [...new Set(raw.filter((c): c is string => typeof c === 'string').map((c) => c.trim().toLowerCase()).filter((c) => KNOWN_CAPABILITIES.includes(c)))] : []
}
export const runnerCapabilities = (r: Pick<ProbeRunner, 'capabilities'>): string[] => normaliseCapabilities(r.capabilities)
export const runnerCanBrowse = (r: Pick<ProbeRunner, 'capabilities'>): boolean => runnerCapabilities(r).includes(BROWSER_CAPABILITY)

const view = (r: ProbeRunner): RunnerView => ({
  runnerId: r.runnerId, locationId: r.locationId, locationKey: r.locationKey, name: r.name, fingerprint: r.fingerprint, status: r.status,
  version: r.version ?? null, lastSeenAt: r.lastSeenAt ?? null, createdAt: r.createdAt, revokedAt: r.revokedAt ?? null, skew: runnerSkew(r.version),
  capabilities: runnerCapabilities(r),
})

export interface SignedRequestInput {
  method: string; path: string; body: string
  runnerId: string | null; timestamp: string | null; nonce: string | null; signature: string | null
}

type NonceStore = (runnerId: string, nonce: string) => Promise<boolean>
const defaultNonceStore: NonceStore = async (runnerId, nonce) => {
  try {
    const { default: redis } = await import('@kuraykaraaslan-labs/redis')
    return (await redis.set(`probe:nonce:${runnerId}:${nonce}`, '1', 'EX', 600, 'NX')) === 'OK'
  } catch { return true } // fail open: replay of a lease or heartbeat is harmless, and results are protected by lease state
}
let nonceStore: NonceStore = defaultNonceStore
/** Test seam. */
export function setNonceStore(fn?: NonceStore): void { nonceStore = fn ?? defaultNonceStore }

export default class ProbeRunnerService {
  static async createEnrolment(tenantId: string, locationId: string, actorId: string | null, now: Date = new Date()): Promise<{ token: string; expiresAt: Date; locationKey: string }> {
    const location = await ProbeLocationService.getRow(tenantId, locationId)
    if (!location.enabled) throw new AppError('The location is disabled', 409, ErrorCode.CONFLICT)
    const token = generateEnrolmentToken()
    const expiresAt = new Date(now.getTime() + ENROLMENT_TTL_MS)
    await withTenantRepositoryFor(tenantId, ProbeEnrolment, (repo) => repo.save(repo.create({
      tenantId, locationId, locationKey: location.key, tokenHash: hashEnrolmentToken(token), expiresAt, usedAt: null, createdBy: actorId,
    })))
    await auditProbe(tenantId, actorId, 'observability.probe.enrolment_created', 'probe_location', locationId, { key: location.key, expiresAt: expiresAt.toISOString() })
    return { token, expiresAt, locationKey: location.key }
  }

  /** Consume an enrolment token and register the runner's public key. Unknown, expired, used and malformed tokens are the same 404. */
  static async enrol(tenantId: string, input: { token: string; publicKeyPem: string; name: string; version?: string | null; capabilities?: string[] | null }, now: Date = new Date()): Promise<RunnerView> {
    if (!looksLikeEnrolmentToken(input.token)) throw notFound()
    let fingerprint: string
    try {
      const key = createPublicKey(input.publicKeyPem)
      if (key.asymmetricKeyType !== 'ed25519') throw new Error('not ed25519')
      fingerprint = keyFingerprint(input.publicKeyPem)
    } catch { throw new AppError('The runner key must be an Ed25519 public key (PEM)', 400, ErrorCode.VALIDATION_ERROR) }

    return withTenantTransactionFor(tenantId, async (qr) => {
      const enrolments = qr.manager.getRepository(ProbeEnrolment)
      const row = await enrolments.findOne({ where: { tenantId, tokenHash: hashEnrolmentToken(input.token) }, lock: { mode: 'pessimistic_write' } })
      if (!row || row.usedAt || new Date(row.expiresAt).getTime() <= now.getTime()) throw notFound()
      // A location switched on for browser checks REQUIRES its runners to report the capability: a plain runner there would take leases it can never run.
      // Refused BEFORE the token is consumed, so the operator can start the right image with the same token.
      const location = await qr.manager.getRepository(ProbeLocation).findOne({ where: { tenantId, locationId: row.locationId } })
      const capabilities = normaliseCapabilities(input.capabilities)
      if (location?.browserEnabled && !capabilities.includes(BROWSER_CAPABILITY)) {
        throw new AppError('This location is enabled for browser checks: enrol it with the browser runner image (a runner that reports the browser capability)', 409, ErrorCode.CONFLICT)
      }
      const duplicate = await qr.manager.getRepository(ProbeRunner).count({ where: { fingerprint } })
      if (duplicate) throw new AppError('This key is already enrolled', 409, ErrorCode.CONFLICT)
      row.usedAt = now
      await enrolments.save(row)
      const runner = await qr.manager.getRepository(ProbeRunner).save(qr.manager.getRepository(ProbeRunner).create({
        tenantId, locationId: row.locationId, locationKey: row.locationKey, name: input.name.trim().slice(0, 120) || row.locationKey,
        publicKeyPem: input.publicKeyPem, fingerprint, status: 'ACTIVE', version: input.version?.slice(0, 40) ?? null, capabilities: capabilities.length ? capabilities : null, lastSeenAt: now, revokedAt: null,
      }))
      return view(runner)
    }).then(async (v) => {
      await ProbeLocationService.markSeen(tenantId, v.locationId, v.version, now)
      await auditProbe(tenantId, null, 'observability.probe.runner_enrolled', 'probe_runner', v.runnerId, { locationKey: v.locationKey, fingerprint: v.fingerprint, name: v.name })
      return v
    })
  }

  /**
   * Who sent this request? Verifies the timestamp (clock skew), the signature over method, path, time, nonce and body hash, that the runner is
   * ACTIVE, and that the nonce was not seen. Every failure is the same 401.
   */
  static async authenticate(tenantId: string, req: SignedRequestInput, now: Date = new Date()): Promise<ProbeRunner> {
    const { runnerId, timestamp, nonce, signature } = req
    if (!runnerId || !timestamp || !nonce || !signature || !/^[0-9a-f-]{36}$/i.test(runnerId) || nonce.length > 64) throw unauthorized()
    const ts = Number(timestamp)
    if (!withinSkew(ts, now)) throw unauthorized()
    const runner = await withTenantRepositoryFor(tenantId, ProbeRunner, (repo) => repo.findOne({ where: { tenantId, runnerId, status: 'ACTIVE' } }))
    if (!runner) throw unauthorized()
    const ok = verifyRequest(runner.publicKeyPem, { method: req.method, path: req.path, timestamp: ts, nonce, bodySha256: sha256Hex(req.body) }, signature)
    if (!ok) throw unauthorized()
    if (!(await nonceStore(runner.runnerId, nonce))) throw unauthorized()
    return runner
  }

  static async heartbeat(runner: ProbeRunner, version: string | null, now: Date = new Date(), capabilities?: string[] | null): Promise<void> {
    // `capabilities` omitted = an older runner that does not say: nothing changes. Present = what the runner can do NOW (a browser that stopped working is withdrawn).
    const caps = capabilities === undefined || capabilities === null ? undefined : normaliseCapabilities(capabilities)
    await withTenantRepositoryFor(runner.tenantId, ProbeRunner, (repo) => repo.update({ tenantId: runner.tenantId, runnerId: runner.runnerId }, { lastSeenAt: now, ...(version ? { version: version.slice(0, 40) } : {}), ...(caps ? { capabilities: caps.length ? caps : null } : {}) }))
    await ProbeLocationService.markSeen(runner.tenantId, runner.locationId, version, now)
  }

  static async list(tenantId: string, locationId?: string): Promise<RunnerView[]> {
    const rows = await withTenantRepositoryFor(tenantId, ProbeRunner, (repo) => repo.find({ where: { tenantId, ...(locationId ? { locationId } : {}) }, order: { createdAt: 'DESC' } }))
    return rows.map(view)
  }

  /** Revoke at once: the runner's next request is a 401. Idempotent. */
  static async revoke(tenantId: string, runnerId: string, now: Date = new Date(), actorId: string | null = null): Promise<RunnerView> {
    const row = await withTenantRepositoryFor(tenantId, ProbeRunner, (repo) => repo.findOne({ where: { tenantId, runnerId } }))
    if (!row) throw new AppError('Runner not found', 404, ErrorCode.NOT_FOUND)
    if (row.status !== 'REVOKED') {
      row.status = 'REVOKED'; row.revokedAt = now
      await withTenantRepositoryFor(tenantId, ProbeRunner, (repo) => repo.save(row))
      await auditProbe(tenantId, actorId, 'observability.probe.runner_revoked', 'probe_runner', runnerId, { locationKey: row.locationKey, fingerprint: row.fingerprint })
    }
    return view(row)
  }
}
