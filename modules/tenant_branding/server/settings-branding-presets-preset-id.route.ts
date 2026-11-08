import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import TenantBrandingPresetService from '@kuraykaraaslan-labs/tenant_branding/server/tenant_branding.preset.service'

type Ctx = { params: Promise<{ tenantId: string; presetId: string }> }

const UpdatePresetDTO = z.object({
  name: z.string().min(1).max(140).optional(),
  description: z.string().max(300).nullable().optional(),
  values: z.record(z.string(), z.string()).optional(),
  isActive: z.boolean().optional(),
})

const ApplyPresetDTO = z.object({
  targetTenantId: z.string().uuid(),
})

/** GET — one preset. */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, presetId } = await params
    await Limiter.checkRateLimit(request)
    await authorizeRequest({ request, tenantId, requiredPermission: 'tenant_branding.presets.read', scope: 'TENANT' })

    const preset = await TenantBrandingPresetService.getById(tenantId, presetId)
    return NextResponse.json({ preset }, { status: 200 })
  } catch (e) {
    return normalizeError(e)
  }
}

/** PUT — edit it. */
export async function PUT(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, presetId } = await params
    await Limiter.checkRateLimit(request)
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'tenant_branding.presets.manage', scope: 'TENANT' })

    const dto = UpdatePresetDTO.parse(await request.json())
    const preset = await TenantBrandingPresetService.update(tenantId, presetId, dto, user.userId)
    return NextResponse.json({ preset }, { status: 200 })
  } catch (e) {
    return normalizeError(e)
  }
}

/**
 * POST — copy it onto another workspace.
 *
 * A COPY, not a link: if the target later changes their own colour, this preset
 * does not take it back. Re-applying is somebody deliberately overwriting a
 * workspace's brand, which is why it is a separate call with its own audit line
 * rather than a background sync.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, presetId } = await params
    await Limiter.checkRateLimit(request)
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'tenant_branding.presets.manage', scope: 'TENANT' })

    const dto = ApplyPresetDTO.parse(await request.json())
    const branding = await TenantBrandingPresetService.clonePreset(
      tenantId, presetId, dto.targetTenantId, user.userId,
    )
    return NextResponse.json({ branding }, { status: 200 })
  } catch (e) {
    return normalizeError(e)
  }
}

/** DELETE — nobody's look changes; a client holds a copy, not a reference. */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, presetId } = await params
    await Limiter.checkRateLimit(request)
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'tenant_branding.presets.manage', scope: 'TENANT' })

    await TenantBrandingPresetService.remove(tenantId, presetId, user.userId)
    return NextResponse.json({ success: true }, { status: 200 })
  } catch (e) {
    return normalizeError(e)
  }
}
