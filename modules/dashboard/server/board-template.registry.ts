import type { RuntimeExtension } from '@kuraykaraaslan-labs/common/server/extension-registry'
import { ext, systemCtx, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext'
import { dashboardBoardTemplateLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/dashboard.board_template'
import Logger from '@kuraykaraaslan-labs/logger'
import { BOARD_TEMPLATES, type BoardTemplate } from './board-templates'
import { parseContributedTemplate } from './board-template.schema'

export const BOARD_TEMPLATE_POINT = 'dashboard:board_template'

/**
 * Built-in templates plus every `dashboard:board_template` contribution from a module
 * ACTIVE for the tenant (K15: a disabled module's templates disappear from the gallery).
 * Without a tenant (no caller today) every contribution counts.
 *
 * The dashboard never names a contributor: it reads the extension registry. A
 * contribution that fails validation, or reuses an existing key, is logged and
 * skipped — one broken module must not blank the gallery, and a contributor must
 * not shadow a built-in or another module's template. Built-ins win a collision.
 * One that fails to load is logged and skipped by the host runtime.
 */
export async function listBoardTemplates(tenantId?: string): Promise<BoardTemplate[]> {
  const out: BoardTemplate[] = Object.values(BOARD_TEMPLATES)
  const taken = new Set(out.map((t) => t.key))
  const ctx = tenantId ? tenantCtx(tenantId) : systemCtx('board template gallery outside a tenant')
  let loaded: Array<{ contribution: RuntimeExtension; impl: unknown }>
  try {
    ({ loaded } = await ext.loadAll<unknown>(BOARD_TEMPLATE_POINT, ctx, dashboardBoardTemplateLoaders))
  } catch {
    return out // stale snapshot: built-ins still work
  }
  for (const { contribution, impl } of loaded) {
    for (const raw of Array.isArray(impl) ? impl : [impl]) {
      const parsed = parseContributedTemplate(raw)
      if (!parsed.ok) {
        Logger.warn(`[dashboard] board template from '${contribution.moduleId}' is invalid and was skipped: ${parsed.error}`)
        continue
      }
      if (taken.has(parsed.template.key)) {
        Logger.warn(`[dashboard] board template key '${parsed.template.key}' (from '${contribution.moduleId}') is already taken and was skipped`)
        continue
      }
      taken.add(parsed.template.key)
      out.push(parsed.template)
    }
  }
  return out
}

export async function findBoardTemplate(key: string, tenantId?: string): Promise<BoardTemplate | null> {
  return (await listBoardTemplates(tenantId)).find((t) => t.key === key) ?? null
}
