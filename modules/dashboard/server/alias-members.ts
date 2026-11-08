import type { NextRequest } from 'next/server'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import MSG from './dashboard.messages'
import { aliasResolverFor, resolveBoardState } from './query-gates'
import { entityParamAlias, isEntityParam, type EntityParamDef } from './board-params'
import type { EntityRef } from './entity-alias.types'
import { appLocaleOf } from './board-template.locale'

/** How many entities one alias list holds: the toolbar select's page, by name. */
export const ALIAS_MEMBERS_PAGE = 50

/** One alias's list, as `POST …/boards/[boardId]/aliases/[aliasKey]/entities` answers it. */
export interface AliasMembers {
  data: EntityRef[]
  total: number
}

/**
 * The toolbar entity select's lists of one board view (phase 36, E36-6), for a caller who passed the members route's own gate
 * (`dashboard.query.execute`): the board read under the same visibility rule as opening it, with the viewer's params, and each
 * entity parameter's entities behind their type's read permission. One implementation for the members route and the board-open
 * answer (phase 40, D40-12), so the two can never answer differently. Since phase 41 an "alias" here is an entity parameter
 * (an old alias key is followed to the parameter it became).
 */
export async function aliasMembersReader(
  request: NextRequest,
  tenantId: string,
  userId: string,
  boardId: string,
  params?: Record<string, unknown>,
): Promise<{ params: EntityParamDef[]; members: (aliasKey: string, search?: string) => Promise<AliasMembers> }> {
  const state = await resolveBoardState(tenantId, userId, { boardId, params })
  const entities = (state.params ?? []).filter(isEntityParam)
  const resolver = aliasResolverFor(state, {
    tenantId, locale: await appLocaleOf(request, tenantId),
    authorize: async (permission) => { await authorizeRequest({ request, tenantId, requiredPermission: permission, scope: 'TENANT' }) },
  })
  return {
    params: entities,
    // A parameter the board does not define is a 404: a key is looked up, never trusted.
    async members(aliasKey, search) {
      const key = state.aliasKeys && Object.prototype.hasOwnProperty.call(state.aliasKeys, aliasKey) ? state.aliasKeys[aliasKey] : aliasKey
      const param = entities.find((p) => p.key === key)
      if (!param) throw new AppError(`${MSG.ALIAS_UNKNOWN}: '${aliasKey}'`, 404, ErrorCode.NOT_FOUND)
      const { entities: data, total } = await resolver.members(entityParamAlias(param), { search, limit: ALIAS_MEMBERS_PAGE })
      return { data, total }
    },
  }
}
