import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import LegalEntityService from '@kuraykaraaslan-labs/organization/server/organization.legal-entity.service'
import { UpdateLegalEntityDTO } from '@kuraykaraaslan-labs/organization/server/organization.dto'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'

type Ctx = { params: Promise<{ tenantId: string; legalEntityId: string }> }

export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, legalEntityId } = await params
    await Limiter.checkRateLimit(request)
    await authorizeRequest({ request, tenantId, requiredPermission: 'organization.legal_entities.read', scope: 'TENANT' })
    const item = await LegalEntityService.getById(tenantId, legalEntityId)
    return NextResponse.json({ item })
  } catch (e) {
    return normalizeError(e)
  }
}

/**
 * `{ isDefault: true }` is a promotion, not a plain field write — the service
 * demotes the previous holder before the partial unique index can see two
 * flagged rows, then re-projects the tenant's identity onto the legacy
 * invoice / terms_consent / payment keys. Both happen inside
 * `LegalEntityService.update`, so this handler stays a thin transport shell.
 */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, legalEntityId } = await params
    await Limiter.checkRateLimit(request)
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'organization.legal_entities.update', scope: 'TENANT' })
    const dto = UpdateLegalEntityDTO.parse(await request.json())
    // organization.01: an edit of the DEFAULT entity (or a promotion to default) rewrites the
    // tenant's invoice seller identity, IBAN and terms keys through the projection, so it
    // also needs the permission that edits those settings.
    const current = await LegalEntityService.getById(tenantId, legalEntityId)
    if (current.isDefault || dto.isDefault === true) {
      await authorizeRequest({ request, tenantId, requiredPermission: 'tenant_setting.config.update', scope: 'TENANT' })
    }
    const item = await LegalEntityService.update(tenantId, legalEntityId, dto, user.userId)
    return NextResponse.json({ item })
  } catch (e) {
    return normalizeError(e)
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, legalEntityId } = await params
    await Limiter.checkRateLimit(request)
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'organization.legal_entities.delete', scope: 'TENANT' })
    await LegalEntityService.delete(tenantId, legalEntityId, user.userId)
    return NextResponse.json({ success: true })
  } catch (e) {
    return normalizeError(e)
  }
}
