import { moduleRegistry } from '@kuraykaraaslan-labs/common/server/module-registry'

/**
 * The data contract a contributed (`dashboard:widget`, ref `ext:<id>`) widget declares in its
 * contribution `metadata` (phase 18.2): the settings `schema` and the `dataSpec` slots it
 * needs filled. Read from the build-time registry, never from anything a browser sends, so a
 * placement can only be bound to slots the owning module said exist. Enabled-module and
 * permission gating stay where they were (`resolvePlacedWidgets`, `assertWidgetPlaceable`);
 * this only answers "what did the contribution declare".
 */
export interface ExtWidgetContract {
  schema?: Record<string, unknown>
  dataSpec: Array<{ key: string; repeatable?: boolean }>
  /** The action sources the widget can fire (16.9), each with its full source key `<type>.<name>`. */
  actionSources: ExtActionSource[]
  /** The scene the widget draws, when it draws one (`metadata.sceneKind`, phase 42): see `SceneContract`. */
  sceneContract?: SceneContract
}

/**
 * A widget that draws a scene bound to its page's subject (docs/phases/07-dashboard/42) says so in its contribution `metadata`, and the
 * dashboard reads it without knowing the widget or its documents:
 *  - `sceneKind`: the `dashboard:scene_kind` contribution it draws (`design`);
 *  - `sceneDocumentSetting`: the card setting that holds the card's own default document (rung 3 of the resolution, D42-5);
 *  - `sceneOwnedSettings`: the settings the binding replaces, which a card overlay may therefore no longer carry (D42-5, D42-13).
 */
export interface SceneContract {
  kind: string
  documentSetting?: string
  owned: string[]
}

const SCENE_KIND = /^[a-z][a-z0-9_]{0,31}$/
const SETTING_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,47}$/
/** The process diagram owns its document fields, `diagramId` and `sceneSlot` (17 settings), so the cap leaves room above them. */
export const MAX_SCENE_OWNED_SETTINGS = 24

export interface ExtActionSource {
  /** `<widgetType>.<name>`: the key a placement stores its entries under. */
  key: string
  name: string
  label: string
  /** Does firing it carry a row the widget holds, so `{ $row }` means something on it? */
  row: boolean
}

const SOURCE_NAME = /^[a-zA-Z0-9_-]{1,40}$/
/** The same rule `ActionSourceKeySchema` applies to a widget-declared source. */
const SOURCE_KEY = /^[a-z][a-zA-Z0-9_-]*\.[a-zA-Z0-9_.-]+$/
export const MAX_EXT_ACTION_SOURCES = 10

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** `metadata.actionSources`: `[{ name, label?, row? }]`, keyed under the widget's type. Anything that does not form a valid source key is ignored. */
function parseActionSources(metadata: Record<string, unknown> | undefined, type: string): ExtActionSource[] {
  const raw = Array.isArray(metadata?.actionSources) ? metadata!.actionSources as unknown[] : []
  const out: ExtActionSource[] = []
  for (const item of raw) {
    if (out.length >= MAX_EXT_ACTION_SOURCES) break
    if (!isPlainObject(item) || typeof item.name !== 'string' || !SOURCE_NAME.test(item.name)) continue
    const key = `${type}.${item.name}`
    if (!SOURCE_KEY.test(key) || key.length > 80 || out.some((o) => o.key === key)) continue
    out.push({ key, name: item.name, label: typeof item.label === 'string' && item.label ? item.label.slice(0, 80) : item.name, row: item.row === true })
  }
  return out
}

/** The scene a contribution's `metadata` declares, or undefined; a malformed declaration is ignored, like the other metadata. */
export function sceneContractOf(metadata: Record<string, unknown> | undefined): SceneContract | undefined {
  const kind = metadata?.sceneKind
  if (typeof kind !== 'string' || !SCENE_KIND.test(kind)) return undefined
  const doc = metadata?.sceneDocumentSetting
  const owned = Array.isArray(metadata?.sceneOwnedSettings) ? (metadata!.sceneOwnedSettings as unknown[]) : []
  return {
    kind,
    ...(typeof doc === 'string' && SETTING_NAME.test(doc) ? { documentSetting: doc } : {}),
    owned: owned.filter((n): n is string => typeof n === 'string' && SETTING_NAME.test(n)).slice(0, MAX_SCENE_OWNED_SETTINGS),
  }
}

/** `fallbackType` is the contribution id, used when `metadata.type` is absent (the descriptor's own rule). */
export function extWidgetContract(metadata: Record<string, unknown> | undefined, fallbackType = ''): ExtWidgetContract {
  const type = typeof metadata?.type === 'string' && metadata.type ? metadata.type : fallbackType
  const slots = Array.isArray(metadata?.dataSpec) ? metadata!.dataSpec as unknown[] : []
  return {
    ...(isPlainObject(metadata?.schema) ? { schema: metadata!.schema as Record<string, unknown> } : {}),
    dataSpec: slots
      .filter((s): s is { key: string; repeatable?: unknown } => isPlainObject(s) && typeof s.key === 'string' && s.key !== '')
      .map((s) => ({ key: s.key, ...(s.repeatable === true ? { repeatable: true } : {}) })),
    actionSources: parseActionSources(metadata, type),
    ...(sceneContractOf(metadata) ? { sceneContract: sceneContractOf(metadata) } : {}),
  }
}

/** The contract of contribution `extId`, or null when no `dashboard:widget` contribution has that id. */
export function findExtWidgetContract(extId: string): ExtWidgetContract | null {
  const ext = moduleRegistry.getComponentExtensions('dashboard:widget').find((e) => e.id === extId)
  return ext ? extWidgetContract(ext.metadata as Record<string, unknown> | undefined, ext.id) : null
}

/**
 * The settings of an overlay patch that a scene binding owns for this widget (D42-5, D42-13): the ones its contribution declares in
 * `sceneOwnedSettings`, present at the top level of `patch` (a `null` removing one counts too: the patch names it). Empty for a widget
 * that draws no scene and for a placement that is not an `ext:` contribution.
 */
export function sceneOwnedKeysIn(widgetRef: string, patch: Record<string, unknown>): string[] {
  if (!widgetRef.startsWith('ext:')) return []
  const owned = findExtWidgetContract(widgetRef.slice(4))?.sceneContract?.owned ?? []
  return owned.filter((k) => Object.hasOwn(patch, k))
}
