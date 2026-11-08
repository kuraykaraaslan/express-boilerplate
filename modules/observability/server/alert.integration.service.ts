import 'reflect-metadata'
import { createHash, randomBytes } from 'node:crypto'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { AlertIntegration } from './entities/alert_integration.entity'
import { assertHeadroomFor } from './observability.limits'
import { OBSERVABILITY_LIMIT_KEYS } from './observability.limit-keys'
import type { CreateIntegrationInput, UpdateIntegrationInput } from './alert.dto'
import { assertEditable } from './config/config.managed'

/**
 * Ingest keys (observability phase 11). A key is a credential: only its hash is stored, it is returned once at creation or rotation, a
 * list shows a short prefix to tell keys apart, and everything a key may do (tenant, parser, highest severity, default labels) is fixed on
 * its row, never taken from what a sender posts.
 */

export const KEY_PREFIX = 'ak_'
const LAST_USED_GRANULARITY_MS = 60_000

export function generateIngestKey(): string { return KEY_PREFIX + randomBytes(24).toString('base64url') }
export function hashIngestKey(key: string): string { return createHash('sha256').update(key, 'utf8').digest('hex') }
export function looksLikeIngestKey(key: string): boolean { return /^ak_[A-Za-z0-9_-]{32}$/.test(key) }

export type IntegrationView = Omit<AlertIntegration, 'keyHash'>

function view(row: AlertIntegration): IntegrationView {
  const { keyHash: _hash, ...rest } = row
  void _hash
  return rest
}

export default class AlertIntegrationService {
  static async list(tenantId: string): Promise<IntegrationView[]> {
    const rows = await withTenantRepositoryFor(tenantId, AlertIntegration, (repo) => repo.find({ where: { tenantId }, order: { createdAt: 'DESC' } }))
    return rows.map(view)
  }

  static async create(tenantId: string, input: CreateIntegrationInput, managed?: { managedBy: string; sourceKey: string | null; enabled?: boolean }): Promise<{ integration: IntegrationView; key: string }> {
    await assertHeadroomFor(tenantId, OBSERVABILITY_LIMIT_KEYS.ALERT_INTEGRATIONS, 'alert integrations',
      () => withTenantRepositoryFor(tenantId, AlertIntegration, (repo) => repo.count({ where: { tenantId } })))
    const key = generateIngestKey()
    const row = await withTenantRepositoryFor(tenantId, AlertIntegration, (repo) => repo.save(repo.create({
      tenantId, name: input.name, kind: input.kind, severityCeiling: input.severityCeiling, defaultLabels: input.defaultLabels ?? null,
      keyHash: hashIngestKey(key), keyPrefix: key.slice(0, 7), enabled: managed?.enabled ?? true,
      ...(managed ? { managedBy: managed.managedBy, sourceKey: managed.sourceKey } : {}),
    })))
    return { integration: view(row), key }
  }

  static async update(tenantId: string, integrationId: string, input: UpdateIntegrationInput): Promise<IntegrationView> {
    const row = await AlertIntegrationService.getRow(tenantId, integrationId)
    assertEditable(row, 'alert integration')
    Object.assign(row, input)
    return view(await withTenantRepositoryFor(tenantId, AlertIntegration, (repo) => repo.save(row)))
  }

  /** A new key; the old one stops working at once. */
  static async rotate(tenantId: string, integrationId: string): Promise<{ integration: IntegrationView; key: string }> {
    const row = await AlertIntegrationService.getRow(tenantId, integrationId)
    const key = generateIngestKey()
    Object.assign(row, { keyHash: hashIngestKey(key), keyPrefix: key.slice(0, 7) })
    return { integration: view(await withTenantRepositoryFor(tenantId, AlertIntegration, (repo) => repo.save(row))), key }
  }

  static async remove(tenantId: string, integrationId: string): Promise<void> {
    assertEditable(await withTenantRepositoryFor(tenantId, AlertIntegration, (repo) => repo.findOne({ where: { tenantId, integrationId } })), 'alert integration')
    const r = await withTenantRepositoryFor(tenantId, AlertIntegration, (repo) => repo.delete({ tenantId, integrationId }))
    if (!r.affected) throw new AppError('Integration not found', 404, ErrorCode.NOT_FOUND)
  }

  /**
   * Resolve a key to its integration inside THIS tenant. A malformed, unknown, rotated-away or disabled key all answer the same 404, so
   * the endpoint cannot be used to learn which keys exist.
   */
  static async authenticate(tenantId: string, key: string): Promise<AlertIntegration> {
    const notFound = () => new AppError('Not found', 404, ErrorCode.NOT_FOUND)
    if (!looksLikeIngestKey(key)) throw notFound()
    const row = await withTenantRepositoryFor(tenantId, AlertIntegration, (repo) =>
      repo.findOne({ where: { tenantId, keyHash: hashIngestKey(key), enabled: true } }))
    if (!row) throw notFound()
    // Stamped at most once a minute: a busy sender must not turn every request into a write.
    if (!row.lastUsedAt || Date.now() - new Date(row.lastUsedAt).getTime() > LAST_USED_GRANULARITY_MS) {
      await withTenantRepositoryFor(tenantId, AlertIntegration, (repo) => repo.update({ tenantId, integrationId: row.integrationId }, { lastUsedAt: new Date() })).catch(() => {})
    }
    return row
  }

  private static async getRow(tenantId: string, integrationId: string): Promise<AlertIntegration> {
    const row = await withTenantRepositoryFor(tenantId, AlertIntegration, (repo) => repo.findOne({ where: { tenantId, integrationId } }))
    if (!row) throw new AppError('Integration not found', 404, ErrorCode.NOT_FOUND)
    return row
  }
}
