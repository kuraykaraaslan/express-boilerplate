import 'reflect-metadata'
import bcrypt from 'bcrypt'
import { z } from 'zod'
import { In } from 'typeorm'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { patchSchema } from '@kuraykaraaslan-labs/common/server/zod-patch'
import { StatusPage } from './entities/status_page.entity'
import { StatusComponent } from './entities/status_component.entity'
import { clearHostBinding, setHostBinding } from './status.host'
import { publishStatusChanged } from './status.realtime'
import { assertHeadroomFor } from './observability.limits'
import { OBSERVABILITY_LIMIT_KEYS } from './observability.limit-keys'
import {
  DEFAULT_PAGE_SLUG, StatusAudienceEnum, StatusThemeEnum, isIpEntry, isLocaleCode, isValidSlug,
  normalizeHostname, normalizeLocale, normalizeOrigin, type StatusAudience, type StatusTheme,
} from './status.page.rules'

/**
 * Status pages (observability phase 15.1): resolution for the public side, CRUD for the admin side.
 *
 * The tenant's original page is the DEFAULT page. It needs no row: with none, the default page is the virtual public page that the
 * single page always was, so a tenant that never touched v2 serves exactly what it served before. The first edit writes the row.
 */

/** The shape every public consumer works with. The hash is carried so the audience gate can verify a token, and goes no further. */
export interface StatusPageSpec {
  /** null for the virtual default page. */
  pageId: string | null
  slug: string
  name: string
  isDefault: boolean
  enabled: boolean
  audience: StatusAudience
  passwordHash: string | null
  ipAllowlist: string[]
  domain: string | null
  theme: StatusTheme
  languages: string[]
  componentIds: string[] | null
  embedOrigins: string[]
  snapshotEnabled: boolean
}

export const MAX_PAGES_PER_TENANT = 20
const MAX_LANGUAGES = 10
const MAX_COMPONENTS_PER_PAGE = 200
const MAX_ORIGINS = 10
const MAX_IP_ENTRIES = 50
const BCRYPT_COST = 10

const notFound = () => new AppError('Not found', 404, ErrorCode.NOT_FOUND)

function toSpec(row: StatusPage): StatusPageSpec {
  return {
    pageId: row.pageId,
    slug: row.slug,
    name: row.name,
    isDefault: row.isDefault,
    enabled: row.enabled,
    audience: StatusAudienceEnum.safeParse(row.audience).success ? (row.audience as StatusAudience) : 'IP', // an unknown value closes the page
    passwordHash: row.passwordHash ?? null,
    ipAllowlist: row.ipAllowlist ?? [],
    domain: row.domain ?? null,
    theme: StatusThemeEnum.safeParse(row.theme).success ? (row.theme as StatusTheme) : 'AUTO',
    languages: row.languages ?? [],
    componentIds: row.componentIds ?? null,
    embedOrigins: row.embedOrigins ?? [],
    snapshotEnabled: row.snapshotEnabled,
  }
}

/** The page a tenant has when it has never edited one: everything public, open to everybody, served at the old URLs. */
export function virtualDefaultPage(): StatusPageSpec {
  return {
    pageId: null, slug: DEFAULT_PAGE_SLUG, name: 'Status', isDefault: true, enabled: true, audience: 'PUBLIC', passwordHash: null,
    ipAllowlist: [], domain: null, theme: 'AUTO', languages: [], componentIds: null, embedOrigins: [], snapshotEnabled: true,
  }
}

// ── DTOs ─────────────────────────────────────────────────────────────────────

const PageFieldsDTO = z.object({
  slug: z.string().refine(isValidSlug, 'lowercase letters, digits and dashes, 1-64 characters'),
  name: z.string().trim().min(1).max(200),
  enabled: z.boolean().default(true),
  audience: StatusAudienceEnum.default('PUBLIC'),
  /** Plain text on the way in only; it is hashed before anything is stored and never returned. */
  password: z.string().min(8).max(128).nullish(),
  ipAllowlist: z.array(z.string().refine(isIpEntry, 'an IPv4/IPv6 address or CIDR block')).max(MAX_IP_ENTRIES).nullish(),
  domain: z.string().max(253).nullish(),
  theme: StatusThemeEnum.default('AUTO'),
  languages: z.array(z.string().refine(isLocaleCode, 'a language code such as en or pt-br')).max(MAX_LANGUAGES).nullish(),
  componentIds: z.array(z.string().uuid()).max(MAX_COMPONENTS_PER_PAGE).nullish(),
  embedOrigins: z.array(z.string().max(200)).max(MAX_ORIGINS).nullish(),
  snapshotEnabled: z.boolean().default(true),
})

export const CreateStatusPageDTO = PageFieldsDTO
export type CreateStatusPageInput = z.infer<typeof CreateStatusPageDTO>
export const UpdateStatusPageDTO = patchSchema(PageFieldsDTO).omit({ slug: true })
export type UpdateStatusPageInput = z.infer<typeof UpdateStatusPageDTO>

/** What the admin screen gets back: never the hash, never a token, only whether a password is set. */
export function toAdminView(row: StatusPage | StatusPageSpec, extra: { virtual?: boolean } = {}) {
  const r = row as StatusPage & StatusPageSpec
  return {
    pageId: r.pageId ?? null,
    slug: r.slug,
    name: r.name,
    isDefault: r.isDefault,
    enabled: r.enabled,
    audience: r.audience,
    hasPassword: Boolean(r.passwordHash),
    ipAllowlist: r.ipAllowlist ?? [],
    domain: r.domain ?? null,
    theme: r.theme,
    languages: r.languages ?? [],
    componentIds: r.componentIds ?? null,
    embedOrigins: r.embedOrigins ?? [],
    snapshotEnabled: r.snapshotEnabled,
    snapshotAt: (r as StatusPage).snapshotAt ?? null,
    snapshotError: (r as StatusPage).snapshotError ?? null,
    virtual: extra.virtual ?? false,
  }
}

export default class StatusPageService {
  // ── public side ────────────────────────────────────────────────────────────

  /** The default page: its row, or the virtual public page when it was never edited. */
  static async getDefault(tenantId: string): Promise<StatusPageSpec> {
    const row = await withTenantRepositoryFor(tenantId, StatusPage, (repo) => repo.findOne({ where: { tenantId, isDefault: true } }))
    return row ? toSpec(row) : virtualDefaultPage()
  }

  /**
   * The page behind a slug, or null. The slug is checked by shape BEFORE any read, so a hostile segment never reaches the database
   * and is answered like any page that does not exist.
   */
  static async resolve(tenantId: string, slug: string): Promise<StatusPageSpec | null> {
    if (!isValidSlug(slug)) return null
    if (slug === DEFAULT_PAGE_SLUG) return StatusPageService.getDefault(tenantId)
    const row = await withTenantRepositoryFor(tenantId, StatusPage, (repo) => repo.findOne({ where: { tenantId, slug } }))
    return row && !row.isDefault ? toSpec(row) : null
  }

  /** The page bound to a host, for the proxy. */
  static async resolveByDomain(tenantId: string, host: string): Promise<StatusPageSpec | null> {
    const domain = normalizeHostname(host)
    if (!domain) return null
    const row = await withTenantRepositoryFor(tenantId, StatusPage, (repo) => repo.findOne({ where: { tenantId, domain } }))
    return row ? toSpec(row) : null
  }

  /** Every PUBLIC, enabled page that publishes a snapshot (the snapshot job's worklist). The virtual default counts. */
  static async listSnapshotPages(tenantId: string): Promise<StatusPageSpec[]> {
    const rows = await withTenantRepositoryFor(tenantId, StatusPage, (repo) => repo.find({ where: { tenantId }, order: { createdAt: 'ASC' } }))
    const specs = rows.map(toSpec)
    if (!specs.some((s) => s.isDefault)) specs.unshift(virtualDefaultPage())
    return specs.filter((s) => s.enabled && s.audience === 'PUBLIC' && s.snapshotEnabled)
  }

  // ── snapshot bookkeeping (phase 15.9) ───────────────────────────────────────

  /** Every page row with its snapshot state; the virtual default page has no row, and so no state, until a snapshot is first published. */
  static async listRows(tenantId: string): Promise<StatusPage[]> {
    return withTenantRepositoryFor(tenantId, StatusPage, (repo) => repo.find({ where: { tenantId }, order: { createdAt: 'ASC' } }))
  }

  /** The row a spec stands for. The default page's row is written on demand (with the defaults it was virtual with), so it has a place to keep state. */
  static async rowFor(tenantId: string, spec: StatusPageSpec, create = false): Promise<StatusPage | null> {
    return withTenantRepositoryFor(tenantId, StatusPage, async (repo) => {
      const found = spec.pageId
        ? await repo.findOne({ where: { tenantId, pageId: spec.pageId } })
        : spec.isDefault ? await repo.findOne({ where: { tenantId, isDefault: true } }) : null
      if (found || !create || !spec.isDefault) return found
      return repo.save(repo.create({ tenantId, slug: DEFAULT_PAGE_SLUG, isDefault: true, name: spec.name }))
    })
  }

  static async recordSnapshot(
    tenantId: string,
    spec: StatusPageSpec,
    state: { snapshotAt: Date | null; snapshotHash: string | null; snapshotFiles: string[] | null; snapshotError: string | null },
  ): Promise<void> {
    const row = await StatusPageService.rowFor(tenantId, spec, true)
    if (!row) return
    await withTenantRepositoryFor(tenantId, StatusPage, (repo) => repo.update({ tenantId, pageId: row.pageId }, state))
  }

  // ── admin side ─────────────────────────────────────────────────────────────

  /** All pages, the virtual default first when it has no row. */
  static async list(tenantId: string): Promise<ReturnType<typeof toAdminView>[]> {
    const rows = await withTenantRepositoryFor(tenantId, StatusPage, (repo) => repo.find({ where: { tenantId }, order: { createdAt: 'ASC' } }))
    const views = rows.map((r) => toAdminView(r))
    if (!rows.some((r) => r.isDefault)) views.unshift(toAdminView(virtualDefaultPage(), { virtual: true }))
    return views.sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
  }

  static async getView(tenantId: string, pageId: string): Promise<ReturnType<typeof toAdminView>> {
    if (pageId === DEFAULT_PAGE_SLUG) {
      const spec = await StatusPageService.getDefault(tenantId)
      return toAdminView(spec, { virtual: spec.pageId === null })
    }
    const row = await withTenantRepositoryFor(tenantId, StatusPage, (repo) => repo.findOne({ where: { tenantId, pageId } })).catch(() => null)
    if (!row) throw new AppError('Status page not found', 404, ErrorCode.NOT_FOUND)
    return toAdminView(row)
  }

  static async create(tenantId: string, input: CreateStatusPageInput): Promise<ReturnType<typeof toAdminView>> {
    if (input.slug === DEFAULT_PAGE_SLUG) throw new AppError('The slug "default" belongs to the default page', 409, ErrorCode.CONFLICT)
    const count = await withTenantRepositoryFor(tenantId, StatusPage, (repo) => repo.count({ where: { tenantId } }))
    // The plan's number (phase 16): the implicit default page counts even before its row exists, so a plan of 1 means "the default page only".
    await assertHeadroomFor(tenantId, OBSERVABILITY_LIMIT_KEYS.STATUS_PAGES, 'status pages', async () => {
      const hasDefault = await withTenantRepositoryFor(tenantId, StatusPage, (repo) => repo.count({ where: { tenantId, isDefault: true } }))
      return count + (hasDefault > 0 ? 0 : 1)
    })
    if (count >= MAX_PAGES_PER_TENANT) throw new AppError(`At most ${MAX_PAGES_PER_TENANT} status pages`, 409, ErrorCode.QUOTA_EXCEEDED)
    const fields = await StatusPageService.prepare(tenantId, input, null)
    try {
      const saved = await withTenantRepositoryFor(tenantId, StatusPage, (repo) => repo.save(repo.create({
        tenantId, slug: input.slug, isDefault: false, ...fields,
      })))
      void StatusPageService.mirrorHost(tenantId, null, saved)
      void publishStatusChanged(tenantId)
      return toAdminView(saved)
    } catch (err) {
      if ((err as { code?: string })?.code === '23505') throw new AppError('A page with this slug or domain already exists', 409, ErrorCode.CONFLICT)
      throw err
    }
  }

  /** Update by page id, or by the alias `default` (which writes the default row the first time). */
  static async update(tenantId: string, pageId: string, patch: UpdateStatusPageInput): Promise<ReturnType<typeof toAdminView>> {
    let row = pageId === DEFAULT_PAGE_SLUG
      ? await withTenantRepositoryFor(tenantId, StatusPage, (repo) => repo.findOne({ where: { tenantId, isDefault: true } }))
      : await withTenantRepositoryFor(tenantId, StatusPage, (repo) => repo.findOne({ where: { tenantId, pageId } })).catch(() => null)
    if (!row && pageId !== DEFAULT_PAGE_SLUG) throw new AppError('Status page not found', 404, ErrorCode.NOT_FOUND)

    const fields = await StatusPageService.prepare(tenantId, patch, row)
    try {
      if (!row) {
        const base = virtualDefaultPage()
        row = await withTenantRepositoryFor(tenantId, StatusPage, (repo) => repo.save(repo.create({
          tenantId, slug: DEFAULT_PAGE_SLUG, isDefault: true, name: base.name, ...fields,
        })))
        void StatusPageService.mirrorHost(tenantId, null, row)
        void publishStatusChanged(tenantId)
        return toAdminView(row)
      }
      const saved = await withTenantRepositoryFor(tenantId, StatusPage, async (repo) => {
        await repo.update({ tenantId, pageId: row!.pageId }, fields)
        return repo.findOne({ where: { tenantId, pageId: row!.pageId } })
      })
      if (saved) {
        void StatusPageService.mirrorHost(tenantId, row, saved)
        void StatusPageService.retractIfNoLongerPublic(tenantId, saved)
        void publishStatusChanged(tenantId)
      }
      return toAdminView(saved ?? row)
    } catch (err) {
      if ((err as { code?: string })?.code === '23505') throw new AppError('A page with this slug or domain already exists', 409, ErrorCode.CONFLICT)
      throw err
    }
  }

  static async remove(tenantId: string, pageId: string): Promise<void> {
    if (pageId === DEFAULT_PAGE_SLUG) throw new AppError('The default page cannot be deleted', 409, ErrorCode.CONFLICT)
    const row = await withTenantRepositoryFor(tenantId, StatusPage, (repo) => repo.findOne({ where: { tenantId, pageId } })).catch(() => null)
    if (!row) throw new AppError('Status page not found', 404, ErrorCode.NOT_FOUND)
    if (row.isDefault) throw new AppError('The default page cannot be deleted', 409, ErrorCode.CONFLICT)
    await withTenantRepositoryFor(tenantId, StatusPage, (repo) => repo.delete({ tenantId, pageId }))
    // A deleted page must not outlive itself at the second origin, nor keep its host.
    void StatusPageService.retractFiles(tenantId, row, row.snapshotFiles ?? [])
    void clearHostBinding(row.domain)
    void publishStatusChanged(tenantId)
  }

  /** Keep the proxy's mirror of the host binding in line with a page row (see `status.host.ts`). Never throws. */
  private static async mirrorHost(tenantId: string, before: StatusPage | null, after: StatusPage): Promise<void> {
    try {
      if (before?.domain && before.domain !== after.domain) await clearHostBinding(before.domain)
      if (!after.domain) return
      if (after.enabled) await setHostBinding(tenantId, after.domain, after.slug)
      else await clearHostBinding(after.domain)
    } catch { /* the heartbeat repairs it */ }
  }

  /** A page that stopped being public, on, or snapshot-enabled gives up its static copy at once (the heartbeat would also, a few minutes later). */
  private static async retractIfNoLongerPublic(tenantId: string, row: StatusPage): Promise<void> {
    const files = row.snapshotFiles ?? []
    if (files.length === 0) return
    if (row.enabled && row.audience === 'PUBLIC' && row.snapshotEnabled) return
    await StatusPageService.retractFiles(tenantId, row, files)
  }

  private static async retractFiles(tenantId: string, row: StatusPage, files: readonly string[]): Promise<void> {
    if (files.length === 0) return
    try {
      const { default: Snapshots } = await import('./status.snapshot.service')
      await Snapshots.retract(tenantId, { slug: row.slug, pageId: row.pageId, isDefault: row.isDefault }, files)
    } catch { /* the heartbeat retracts what this could not */ }
  }

  /**
   * Turn an input into the columns to write: hash the password, normalise languages, hosts and origins, check the references, and
   * refuse a combination that would leave a page open by accident (a password page without a password, an IP page without addresses).
   */
  private static async prepare(
    tenantId: string,
    input: Partial<CreateStatusPageInput>,
    existing: StatusPage | null,
  ): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {}
    const has = (k: keyof CreateStatusPageInput) => input[k] !== undefined

    if (input.name !== undefined) out.name = input.name
    if (input.enabled !== undefined) out.enabled = input.enabled
    if (input.theme !== undefined) out.theme = input.theme
    if (input.snapshotEnabled !== undefined) out.snapshotEnabled = input.snapshotEnabled

    const audience = (input.audience ?? existing?.audience ?? 'PUBLIC') as StatusAudience
    out.audience = audience

    if (input.password) out.passwordHash = await bcrypt.hash(input.password, BCRYPT_COST)
    if (audience === 'PASSWORD' && !out.passwordHash && !existing?.passwordHash) {
      throw new AppError('A password page needs a password', 422, ErrorCode.VALIDATION_ERROR)
    }
    // A hash that no audience uses is not kept around.
    if (audience !== 'PASSWORD') out.passwordHash = null

    const ips = input.ipAllowlist === undefined ? existing?.ipAllowlist ?? null : input.ipAllowlist
    if (audience === 'IP' && (!ips || ips.length === 0)) throw new AppError('An IP page needs at least one address or range', 422, ErrorCode.VALIDATION_ERROR)
    if (has('ipAllowlist') || audience !== 'IP') out.ipAllowlist = audience === 'IP' ? (ips ?? []).map((e) => e.trim()) : null

    if (has('languages')) {
      out.languages = (input.languages ?? []).map(normalizeLocale).filter((l, i, all) => all.indexOf(l) === i)
    }

    if (has('embedOrigins')) {
      const origins = (input.embedOrigins ?? []).map((o) => normalizeOrigin(o))
      if (origins.some((o) => o === null)) throw new AppError('An embed origin must be https://host[:port], with no path or wildcard', 422, ErrorCode.VALIDATION_ERROR)
      if (origins.length > 0 && audience !== 'PUBLIC') throw new AppError('Only a public page can be embedded', 422, ErrorCode.VALIDATION_ERROR)
      out.embedOrigins = [...new Set(origins as string[])]
    } else if (audience !== 'PUBLIC') {
      out.embedOrigins = null
    }

    if (has('componentIds')) {
      const ids = [...new Set(input.componentIds ?? [])]
      if (input.componentIds === null) out.componentIds = null
      else {
        if (ids.length) {
          const owned = await withTenantRepositoryFor(tenantId, StatusComponent, (repo) => repo.count({ where: { tenantId, componentId: In(ids) } }))
          if (owned !== ids.length) throw new AppError('One or more components do not exist', 400, ErrorCode.VALIDATION_ERROR)
        }
        out.componentIds = ids
      }
    }

    if (has('domain')) {
      const rawDomain = input.domain
      if (!rawDomain) out.domain = null
      else {
        const host = normalizeHostname(rawDomain)
        if (!host) throw new AppError('Not a valid host name', 422, ErrorCode.VALIDATION_ERROR)
        const { default: StatusDomainService } = await import('./status.domain.service')
        await StatusDomainService.assertBindable(tenantId, host)
        out.domain = host
      }
    }
    return out
  }

  /** Throw the one 404 every refusal uses. */
  static notFound(): AppError { return notFound() }
}
