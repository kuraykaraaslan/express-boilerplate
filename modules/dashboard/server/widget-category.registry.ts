import type { RuntimeExtension } from '@kuraykaraaslan-labs/common/server/extension-registry'
import { ext, systemCtx, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext'
import { dashboardWidgetCategoryLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/dashboard.widget_category'
import Logger from '@kuraykaraaslan-labs/logger'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import MSG from './dashboard.messages'
import { contributedLabelTexts } from './contributed-label-texts'
import { englishLabels, labelGroupSlug, widgetCategoryLabelKey, type LabelText } from './contributed-labels'
import {
  mergeCategories, parseContributedCategory, isWritableCategory,
  type WidgetCategory,
} from './widget-category'

export const WIDGET_CATEGORY_POINT = 'dashboard:widget_category'

/**
 * Core categories plus every `dashboard:widget_category` contribution from a module
 * ACTIVE for the tenant (a disabled module's categories disappear, like its widgets).
 * Without a tenant (no caller today) every contribution counts.
 *
 * The dashboard never names a contributor. An invalid contribution, or one reusing
 * a taken key, is logged and skipped — one broken module must not blank the picker;
 * one that fails to load is logged and skipped by the host runtime.
 */
export async function listWidgetCategories(tenantId?: string, locale?: string): Promise<WidgetCategory[]> {
  const ctx = tenantId ? tenantCtx(tenantId) : systemCtx('widget category registry outside a tenant')
  let loaded: Array<{ contribution: RuntimeExtension; impl: unknown }>
  try {
    ({ loaded } = await ext.loadAll<unknown>(WIDGET_CATEGORY_POINT, ctx, dashboardWidgetCategoryLoaders))
  } catch {
    // stale snapshot: core categories still work
    return localizeCategories(mergeCategories([]), locale ? await contributedLabelTexts(locale, ['dashboard']) : englishLabels)
  }
  const contributed: WidgetCategory[] = []
  for (const { contribution, impl } of loaded) {
    for (const raw of Array.isArray(impl) ? impl : [impl]) {
      const parsed = parseContributedCategory(raw)
      if (!parsed.ok) {
        Logger.warn(`[dashboard] widget category from '${contribution.moduleId}' is invalid and was skipped: ${parsed.error}`)
        continue
      }
      contributed.push({ ...parsed.category, source: contribution.moduleId })
    }
  }
  const merged = mergeCategories(contributed)
  if (!locale) return merged
  return localizeCategories(merged, await contributedLabelTexts(locale, ['dashboard', ...contributed.map((c) => c.source)]))
}

/**
 * The categories' names in the language of `text` (D551): the dashboard's own under `dashboard.widgetCategory.<slug>`, a contributed one
 * under its module's `<module>.widgetCategory.<slug>`. The key stays what is stored; only the name a person reads changes. Pure.
 */
export function localizeCategories(categories: WidgetCategory[], text: LabelText): WidgetCategory[] {
  if (text === englishLabels) return categories
  return categories.map((c) => ({
    ...c,
    label: text(c.source === 'core' ? `dashboard.widgetCategory.${labelGroupSlug(c.key)}` : widgetCategoryLabelKey(c.source, c.key), c.label),
  }))
}

/**
 * Write-time gate for `category` (create / update): a value that is not a registry
 * key is a 422. Reads never call this, so a row with a legacy value stays readable
 * and an unrelated edit of it is not blocked — only changing the category is checked.
 */
export async function assertWritableCategory(category: string, tenantId?: string): Promise<void> {
  const registry = await listWidgetCategories(tenantId)
  if (!isWritableCategory(category, registry)) {
    const allowed = registry.map((c) => c.key)
    // `details.allowed`: the client lists the keys after its own translated text (the English detail is dropped there).
    throw new AppError(
      `${MSG.WIDGET_CATEGORY_UNKNOWN}: '${category}'. Use one of: ${allowed.join(', ')}.`,
      422,
      ErrorCode.VALIDATION_ERROR,
      { details: { allowed } },
    )
  }
}
