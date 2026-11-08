import 'reflect-metadata'
import { createHash } from 'node:crypto'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { ROOT_TENANT_ID, isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants'
import { ProbeLocation } from './entities/probe_location.entity'
import { ProbeRunner } from './entities/probe_runner.entity'
import { LOCAL_LOCATION, LOCATION_KEY_RE } from './probe.quorum'
import { normalisePolicy, policyEntryProblem, type TargetPolicy } from './probe.policy'
import { auditProbe } from './probe.audit'
import { assertHeadroomFor } from './observability.limits'
import { OBSERVABILITY_LIMIT_KEYS as K } from './observability.limit-keys'

/**
 * Probe locations (observability phase 10.1).
 *
 *  - PUBLIC locations are published by the ROOT tenant. The rows live in the ROOT tenant and every tenant READS them through this service
 *    (the same shape as the dashboard's root catalogue): no row with a nullable tenant is invented, and a tenant can never write one.
 *  - PRIVATE locations belong to one tenant and are only ever read with that tenant's id.
 *  - A location with no live runner is hidden from the picker (no fake regions): the tenant sees its own private locations either way, flagged.
 */
export const LOCATION_LIVE_MS = 5 * 60_000

export interface LocationView {
  locationId: string
  key: string
  kind: 'PUBLIC' | 'PRIVATE'
  label: string
  enabled: boolean
  live: boolean
  lastSeenAt: Date | null
  version: string | null
  /** BROWSER checks may be placed here: a private location always (it is the tenant's own runner), a public one only when the ROOT tenant enabled it. */
  browserEligible: boolean
  /** The explicit flag (public locations; always false for a private one). */
  browserEnabled: boolean
  /** Only for the tenant's own private locations. */
  targetPolicy?: TargetPolicy
  /** Whether a status page may show this location: null = the default of its kind (PUBLIC yes, PRIVATE no). */
  publicVisible: boolean | null
  /** The name a status page shows for it. */
  publicLabel: string | null
}

const isLive = (l: Pick<ProbeLocation, 'lastSeenAt' | 'enabled'>, now: Date) =>
  l.enabled && !!l.lastSeenAt && now.getTime() - new Date(l.lastSeenAt).getTime() <= LOCATION_LIVE_MS

/** May BROWSER checks be placed at this location? Private: yes (the tenant's own runner). Public: only when explicitly enabled. */
export const browserEligibleOf = (l: Pick<ProbeLocation, 'kind' | 'browserEnabled'>): boolean => l.kind === 'PRIVATE' || l.browserEnabled === true

function view(l: ProbeLocation, now: Date, own: boolean): LocationView {
  return {
    locationId: l.locationId, key: l.key, kind: l.kind as 'PUBLIC' | 'PRIVATE', label: l.label, enabled: l.enabled, live: isLive(l, now),
    lastSeenAt: l.lastSeenAt ?? null, version: l.version ?? null,
    publicVisible: l.publicVisible ?? null, publicLabel: l.publicLabel ?? null,
    browserEligible: browserEligibleOf(l), browserEnabled: l.browserEnabled === true,
    ...(own && l.kind === 'PRIVATE' ? { targetPolicy: normalisePolicy(l.targetPolicy) } : {}),
  }
}

export interface CreateLocationInput { key: string; label: string; kind?: 'PUBLIC' | 'PRIVATE'; targetPolicy?: unknown; browserEnabled?: boolean }

/** A probe location as a status page may show it: an opaque stable id and a public label, and nothing else (never the key, the runner or the heartbeat). */
export interface ExposedLocation { regionId: string; label: string }

/** The id a status page uses for a location: stable (the same location is the same id on every request and every language), opaque (a hash, not the key or the row id) and per tenant. */
export function regionIdFor(tenantId: string, locationId: string): string {
  return createHash('sha256').update(`status-region:${tenantId}:${locationId}`).digest('hex').slice(0, 16)
}

const cleanPublicLabel = (v: string | null | undefined): string | null => {
  const t = (v ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
  return t || null
}

function validatePolicy(raw: unknown): TargetPolicy {
  const policy = normalisePolicy(raw)
  const problems = [
    ...policy.cidrs.map((c) => policyEntryProblem('cidr', c)),
    ...policy.hostnames.map((h) => policyEntryProblem('hostname', h)),
  ].filter((p): p is string => p !== null)
  if (problems.length) throw new AppError(`The target allow-list is invalid: ${problems[0]}`, 400, ErrorCode.VALIDATION_ERROR, { details: { problems } })
  return policy
}

export default class ProbeLocationService {
  /** Locations a tenant may pick for a monitor: the published public ones that are live, and its own private ones. */
  static async list(tenantId: string, now: Date = new Date()): Promise<LocationView[]> {
    const own = await withTenantRepositoryFor(tenantId, ProbeLocation, (repo) => repo.find({ where: { tenantId }, order: { createdAt: 'ASC' } }))
    const published = isRootTenant(tenantId) ? [] : await ProbeLocationService.publicCatalogue()
    return [
      ...published.filter((l) => l.enabled && isLive(l, now)).map((l) => view(l, now, false)),
      ...own.map((l) => view(l, now, true)),
    ]
  }

  /**
   * The locations a STATUS PAGE of this tenant may show, by location key (phase 10.5). Only what the tenant chose to expose AND a runner really serves:
   *  - the tenant's own PRIVATE location: only with an explicit `publicVisible = true` AND a public label (its internal label is never used for this);
   *  - a PUBLIC catalogue location (published by the ROOT tenant, so its key and label are already public to every tenant): shown unless the ROOT
   *    tenant switched it off, under its public label or its catalogue label;
   *  - never a location that is disabled or has no live runner (D-OBS-5: no fake regions), never `local` (it is not a row), never another tenant's
   *    private location (own rows are read with the tenant id, the catalogue only with `kind = PUBLIC`).
   * The result carries no key, no runner and no heartbeat time: the one serializer needs nothing more.
   */
  static async exposedForStatus(tenantId: string, keys: readonly string[], now: Date = new Date()): Promise<Map<string, ExposedLocation>> {
    const out = new Map<string, ExposedLocation>()
    const wanted = new Set(keys.filter((k) => k !== LOCAL_LOCATION))
    if (wanted.size === 0) return out
    const own = await withTenantRepositoryFor(tenantId, ProbeLocation, (repo) => repo.find({ where: { tenantId } }))
    const ownByKey = new Map(own.map((l) => [l.key, l]))
    const catalogue = isRootTenant(tenantId) ? [] : await ProbeLocationService.publicCatalogue()
    const candidates: ProbeLocation[] = []
    for (const key of wanted) {
      const mine = ownByKey.get(key)
      if (mine) { candidates.push(mine); continue }
      const pub = catalogue.find((l) => l.key === key && l.kind === 'PUBLIC')
      if (pub) candidates.push(pub)
    }
    for (const row of candidates) {
      if (!row.enabled || !isLive(row, now)) continue
      const isPublicKind = row.kind === 'PUBLIC'
      const visible = isPublicKind ? row.publicVisible !== false : row.publicVisible === true
      if (!visible) continue
      const label = cleanPublicLabel(row.publicLabel) ?? (isPublicKind ? cleanPublicLabel(row.label) : null)
      if (!label) continue
      out.set(row.key, { regionId: regionIdFor(tenantId, row.locationId), label })
    }
    return out
  }

  private static publicCatalogue(): Promise<ProbeLocation[]> {
    return withTenantRepositoryFor(ROOT_TENANT_ID, ProbeLocation, (repo) => repo.find({ where: { tenantId: ROOT_TENANT_ID, kind: 'PUBLIC' }, order: { key: 'ASC' } }))
  }

  static async create(tenantId: string, input: CreateLocationInput, actorId: string | null = null): Promise<LocationView> {
    const key = input.key.trim().toLowerCase()
    if (key === LOCAL_LOCATION || !LOCATION_KEY_RE.test(key)) throw new AppError(`"${input.key}" is not a valid location key`, 400, ErrorCode.VALIDATION_ERROR)
    // Only the ROOT tenant publishes public locations; everyone else creates private ones, whatever the body says.
    const kind = isRootTenant(tenantId) && input.kind === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE'
    if (kind === 'PUBLIC' && input.targetPolicy) throw new AppError('A public location has no allow-list: it may only reach public addresses', 400, ErrorCode.VALIDATION_ERROR)
    const targetPolicy = kind === 'PRIVATE' ? validatePolicy(input.targetPolicy) : null
    if (kind === 'PRIVATE') {
      await assertHeadroomFor(tenantId, K.PRIVATE_LOCATIONS, 'private locations',
        () => withTenantRepositoryFor(tenantId, ProbeLocation, (repo) => repo.count({ where: { tenantId, kind: 'PRIVATE' } })))
    }
    if (kind === 'PRIVATE' && !isRootTenant(tenantId)) {
      // A tenant's key must not shadow a published one: "eu-west" in a picker must mean one thing.
      const clash = (await ProbeLocationService.publicCatalogue()).some((l) => l.key === key)
      if (clash) throw new AppError(`"${key}" is a published location; choose another key`, 409, ErrorCode.CONFLICT)
    }
    const taken = await withTenantRepositoryFor(tenantId, ProbeLocation, (repo) => repo.count({ where: { tenantId, key } }))
    if (taken) throw new AppError(`A location "${key}" already exists`, 409, ErrorCode.CONFLICT)
    const row = await withTenantRepositoryFor(tenantId, ProbeLocation, (repo) => repo.save(repo.create({
      tenantId, key, kind, label: input.label.trim().slice(0, 120), enabled: true, targetPolicy, lastSeenAt: null, version: null,
      browserEnabled: kind === 'PUBLIC' && input.browserEnabled === true,
    })))
    await auditProbe(tenantId, actorId, 'observability.probe.location_created', 'probe_location', row.locationId, { key, kind, targetPolicy, browserEnabled: row.browserEnabled })
    return view(row, new Date(), true)
  }

  static async getRow(tenantId: string, locationId: string): Promise<ProbeLocation> {
    const row = await withTenantRepositoryFor(tenantId, ProbeLocation, (repo) => repo.findOne({ where: { tenantId, locationId } }))
    if (!row) throw new AppError('Location not found', 404, ErrorCode.NOT_FOUND)
    return row
  }

  static async update(tenantId: string, locationId: string, input: { label?: string; enabled?: boolean; targetPolicy?: unknown; browserEnabled?: boolean; publicVisible?: boolean | null; publicLabel?: string | null }, actorId: string | null = null): Promise<LocationView> {
    const row = await ProbeLocationService.getRow(tenantId, locationId)
    const before = { enabled: row.enabled, targetPolicy: normalisePolicy(row.targetPolicy), browserEnabled: row.browserEnabled === true }
    const exposureBefore = { publicVisible: row.publicVisible ?? null, publicLabel: row.publicLabel ?? null }
    if (input.publicLabel !== undefined) row.publicLabel = cleanPublicLabel(input.publicLabel)
    if (input.publicVisible !== undefined) row.publicVisible = input.publicVisible
    // A private location is exposed only under a name written FOR the page: its internal label ("rack 4 behind the customer VPN") is not that name.
    if (row.kind === 'PRIVATE' && row.publicVisible === true && !cleanPublicLabel(row.publicLabel)) {
      throw new AppError('A private location needs a public label before a status page may show it', 422, ErrorCode.VALIDATION_ERROR)
    }
    if (input.label !== undefined) row.label = input.label.trim().slice(0, 120)
    if (input.enabled !== undefined) row.enabled = input.enabled
    if (input.targetPolicy !== undefined) {
      if (row.kind === 'PUBLIC') throw new AppError('A public location has no allow-list', 400, ErrorCode.VALIDATION_ERROR)
      row.targetPolicy = validatePolicy(input.targetPolicy)
    }
    if (input.browserEnabled !== undefined) {
      // Only a PUBLIC location carries the flag: a private one is the tenant's own runner and is always allowed to host their browser checks.
      if (row.kind !== 'PUBLIC') throw new AppError('A private location needs no browser flag: it can host browser checks when its runner reports the browser capability', 400, ErrorCode.VALIDATION_ERROR)
      row.browserEnabled = input.browserEnabled
    }
    const saved = await withTenantRepositoryFor(tenantId, ProbeLocation, (repo) => repo.save(row))
    // What may be reached is the security-relevant part, so a change to it records both sides.
    await auditProbe(tenantId, actorId, 'observability.probe.location_updated', 'probe_location', saved.locationId, { key: saved.key, before, after: { enabled: saved.enabled, targetPolicy: normalisePolicy(saved.targetPolicy), browserEnabled: saved.browserEnabled === true } })
    const exposureAfter = { publicVisible: saved.publicVisible ?? null, publicLabel: saved.publicLabel ?? null }
    if (exposureBefore.publicVisible !== exposureAfter.publicVisible || exposureBefore.publicLabel !== exposureAfter.publicLabel) {
      // What a PUBLIC page may say about a location is outward-facing, so its change is recorded with both sides, like the allow-list.
      await auditProbe(tenantId, actorId, 'observability.probe.location_exposure_changed', 'probe_location', saved.locationId, { key: saved.key, before: exposureBefore, after: exposureAfter })
    }
    return view(saved, new Date(), true)
  }

  /** Removing a location revokes its runners with it (they have nowhere to run). Monitors that still name it simply stop getting samples from it, and it goes stale. */
  static async remove(tenantId: string, locationId: string, actorId: string | null = null): Promise<void> {
    const row = await ProbeLocationService.getRow(tenantId, locationId)
    await withTenantRepositoryFor(tenantId, ProbeRunner, (repo) => repo.update({ tenantId, locationId: row.locationId, status: 'ACTIVE' }, { status: 'REVOKED', revokedAt: new Date() }))
    await withTenantRepositoryFor(tenantId, ProbeLocation, (repo) => repo.delete({ tenantId, locationId }))
    await auditProbe(tenantId, actorId, 'observability.probe.location_deleted', 'probe_location', locationId, { key: row.key })
  }

  /**
   * Check the locations a monitor asks for: each is `local`, a published public location, or one of the tenant's own, and is enabled.
   * Returns the cleaned list (lowercased, deduplicated, `local` first). A monitor that uses a PUBLIC location may not carry secrets: the
   * lease would hand them to a runner the platform operates, and a tenant's own secrets stay with a runner the tenant operates.
   */
  static async resolveForMonitor(tenantId: string, keys: readonly string[], opts: { hasSecrets?: boolean; browser?: boolean } = {}): Promise<string[]> {
    const wanted = [...new Set(keys.map((k) => k.trim().toLowerCase()).filter(Boolean))]
    if (wanted.length === 0) return []
    const remote = wanted.filter((k) => k !== LOCAL_LOCATION)
    const found = new Map<string, ProbeLocation>()
    if (remote.length) {
      const own = await withTenantRepositoryFor(tenantId, ProbeLocation, (repo) => repo.find({ where: { tenantId } }))
      for (const l of own) found.set(l.key, l)
      if (!isRootTenant(tenantId)) for (const l of await ProbeLocationService.publicCatalogue()) if (!found.has(l.key)) found.set(l.key, l)
    }
    for (const k of remote) {
      const l = found.get(k)
      if (!l || !l.enabled) throw new AppError(`Unknown or disabled location "${k}"`, 400, ErrorCode.VALIDATION_ERROR, { details: { location: k } })
      if (opts.browser && !browserEligibleOf(l)) {
        throw new AppError(`Location "${k}" is not enabled for browser checks`, 400, ErrorCode.VALIDATION_ERROR, { details: { location: k } })
      }
      if (l.kind === 'PUBLIC' && opts.hasSecrets) {
        throw new AppError('A monitor with secrets cannot run from a public location; use a private location you operate', 400, ErrorCode.VALIDATION_ERROR, { details: { location: k } })
      }
    }
    return wanted.includes(LOCAL_LOCATION) ? [LOCAL_LOCATION, ...remote] : remote
  }

  /** Stamp the location live (a runner heartbeat or lease poll). Never throws. */
  static async markSeen(tenantId: string, locationId: string, version: string | null, now: Date = new Date()): Promise<void> {
    await withTenantRepositoryFor(tenantId, ProbeLocation, (repo) => repo.update({ tenantId, locationId }, { lastSeenAt: now, ...(version ? { version } : {}) })).catch(() => {})
  }
}
