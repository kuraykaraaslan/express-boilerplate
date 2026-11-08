import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import TenantBrandingPresetService from '@kuraykaraaslan-labs/tenant_branding/server/tenant_branding.preset.service'

type Ctx = { params: Promise<{ tenantId: string }> }

const CreatePresetDTO = z.object({
  name: z.string().min(1).max(140),
  description: z.string().max(300).nullable().optional(),
  values: z.record(z.string(), z.string()).optional(),
  /**
   * Snapshot this tenant's live branding instead of sending values. Getting the
   * look right on a workspace and then keeping it beats typing twelve settings
   * into a form a second time.
   */
  captureFromTenantId: z.string().uuid().optional(),
})

/** GET — the presets this tenant owns. */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    await authorizeRequest({ request, tenantId, requiredPermission: 'tenant_branding.presets.read', scope: 'TENANT' })

    const includeInactive = new URL(request.url).searchParams.get('includeInactive') === 'true'
    const presets = await TenantBrandingPresetService.list(tenantId, includeInactive)
    return NextResponse.json({ presets }, { status: 200 })
  } catch (e) {
    return normalizeError(e)
  }
}

/** POST — define one, or capture the current look. */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'tenant_branding.presets.manage', scope: 'TENANT' })

    const dto = CreatePresetDTO.parse(await request.json())
    const preset = dto.captureFromTenantId
      ? await TenantBrandingPresetService.captureFrom(
        tenantId, dto.captureFromTenantId, { name: dto.name, description: dto.description }, user.userId,
      )
      : await TenantBrandingPresetService.create(tenantId, dto, user.userId)
    return NextResponse.json({ preset }, { status: 201 })
  } catch (e) {
    return normalizeError(e)
  }
}
