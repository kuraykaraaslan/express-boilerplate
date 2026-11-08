import type { NextRequest } from 'next/server'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { selectEntityType } from './entity-types'
import type { CardSubject } from './card-overlay'
import MSG from './dashboard.messages'
import { appLocaleOf } from './board-template.locale'

/**
 * A card overlay's subject, checked for one request (phase 38, E38-11): its entity type is a contributed one (404 otherwise), the
 * caller holds that type's read permission (a station's own diagram is the station's data), and, for a write, the entity exists in
 * the tenant (422). A read of a subject that does not exist simply finds no overlay.
 */
export async function assertSubjectReadable(request: NextRequest, tenantId: string, subject: CardSubject, opts: { mustExist?: boolean; unknownMessage?: string } = {}): Promise<void> {
  const type = await selectEntityType(tenantId, subject.type)
  await authorizeRequest({ request, tenantId, requiredPermission: type.requiredPermission, scope: 'TENANT' })
  if (!opts.mustExist) return
  const found = await type.byIds({ tenantId, locale: await appLocaleOf(request, tenantId) }, [subject.id])
  if (!found.some((e) => e.id === subject.id)) throw new AppError(opts.unknownMessage ?? MSG.OVERLAY_SUBJECT_UNKNOWN, 422, ErrorCode.VALIDATION_ERROR)
}
