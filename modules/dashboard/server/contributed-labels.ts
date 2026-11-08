// The dashboard's localisation seam (D551, phase 39.16; OPB-20 lifted for this seam only): the labels other modules declare for the
// dashboard in English (a `dashboard:widget` contribution's name, settings, data slots and events; a manifest widget's name; a data
// source's group name; a countable; a `dashboard:command` and its parameters; a contributed widget category) are shown in the viewer's
// app language through keys DERIVED BY CONVENTION, as the admin shell translates a menu item (`<module>.menu.<id>`). Each key lives in
// the dictionary of the module that declares the label, so the dashboard imports no module to translate it; the texts are read through
// the generated dictionary map (`contributed-label-texts.ts`). A key without a text in the language reads the English label as declared.
//
// Pure: key builders and the functions that rewrite a declaration's labels with a `LabelText` (no I/O). scripts/i18n/extract.mjs (plain
// JS, it cannot import this file) builds the same keys for module.json declarations, and scripts/i18n/dashboard-labels.parity.test.ts
// checks that both agree.
//
// Keys (moduleId = the module that declares the label):
//   widget        <m>.dashboardWidget.<idSlug(key)>                    a manifest widget (key = its id) or a `dashboard:widget`
//                                                                       contribution (key = the contribution key); an explicit
//                                                                       `metadata.labelKey` on the contribution names its own key
//     field       <widget>.field.<idSlug(name)>                         a settings field's `label` (schema fields never take an explicit
//                                                                       key: `labelKey` on a field is a remote-select's option column)
//       .help     <field>.help                                          its `description`
//       .placeholder, .empty                                            its `placeholder`, its `emptyLabel`
//       .option   <field>.option.<idSlug(value)>                        an option's label
//       sub-field <field>.field.<idSlug(name)>                          a repeater's `fields`; a variant `<field>.case.<idSlug(case)>`
//     slot        <widget>.slot.<idSlug(key)>                           a data slot (`dataSpec[].label`)
//     action      <widget>.action.<idSlug(name)>                        an event (`actionSources[].label`)
//   shelf         <m>.dashboardWidgetShelf                              the category line of a module's widgets that name no category
//   data source   <m>.dataSource.<idSlug(key)>                          a `dashboard:data_source` group (`metadata.label`); an explicit
//                                                                       `metadata.labelKey` names its own key
//   countable     <m>.countable.<key>                                   a `dashboard:countable` (the key as declared, as the home tiles read
//                                                                       it since e2e run 1); a countable's own `labelKey` names its own key
//   command       <m>.dashboardCommand.<idSlug(local key)>              a `dashboard:command` (local key = the key without its `<m>.`
//                                                                       prefix); its parameters as fields: `<command>.field.<name>` …
//   category      <m>.widgetCategory.<groupSlug(key)>                   a `dashboard:widget_category` contribution; the dashboard's own
//                                                                       categories under `dashboard.widgetCategory.<groupSlug(key)>`
//
// Slug rules (never a dot): idSlug = characters outside [A-Za-z0-9_] -> '_' ('members-by-role' -> 'members_by_role'), '' -> '_empty';
// groupSlug = lower-cased, runs outside [a-z0-9] -> one '_', trimmed ('Process & SCADA' -> 'process_scada'), '' -> '_empty'.

/** A text for a key, the English as declared when the language has none. */
export type LabelText = (key: string, english: string) => string

/** The English as declared: what every server-internal reader (export, queries, audit) keeps. */
export const englishLabels: LabelText = (_key, english) => english

export function labelIdSlug(id: string): string {
  const slug = id.replace(/[^A-Za-z0-9_]/g, '_')
  return slug === '' ? '_empty' : slug
}

export function labelGroupSlug(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return slug === '' ? '_empty' : slug
}

/** The module a key belongs to: its first segment. */
export const moduleOfLabelKey = (key: string): string => key.slice(0, Math.max(0, key.indexOf('.')))

export const widgetLabelKey = (moduleId: string, key: string): string => `${moduleId}.dashboardWidget.${labelIdSlug(key)}`
export const widgetShelfKey = (moduleId: string): string => `${moduleId}.dashboardWidgetShelf`
export const dataSourceLabelKey = (moduleId: string, key: string): string => `${moduleId}.dataSource.${labelIdSlug(key)}`
export const countableLabelKey = (moduleId: string, key: string): string => `${moduleId}.countable.${key}`
export const widgetCategoryLabelKey = (moduleId: string, key: string): string => `${moduleId}.widgetCategory.${labelGroupSlug(key)}`

/** `<m>.dashboardCommand.<local key>`: `iot_rpc.call` of iot_rpc -> `iot_rpc.dashboardCommand.call`. */
export function commandLabelKey(moduleId: string, commandKey: string): string {
  const local = commandKey.startsWith(`${moduleId}.`) ? commandKey.slice(moduleId.length + 1) : commandKey
  return `${moduleId}.dashboardCommand.${labelIdSlug(local)}`
}

/** An explicit key a declaration may carry (contribution metadata, a countable): a module-prefixed dictionary key, else none. */
export function explicitLabelKey(value: unknown, moduleId: string): string | undefined {
  return typeof value === 'string' && value.startsWith(`${moduleId}.`) && value.length > moduleId.length + 1 ? value : undefined
}

/** A code made readable: `tenant_member` -> "Tenant member" (the English of a module's shelf). */
export function codeWords(code: string): string {
  const s = code.replace(/[_\-.]+/g, ' ').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A field's texts, sub-fields and variant cases under `key` (see the header). Anything that is not a field is left as it is. */
function localizeField(field: unknown, key: string, text: LabelText): unknown {
  if (!isObject(field)) return field
  const out: Record<string, unknown> = { ...field }
  if (typeof field.label === 'string' && field.label) out.label = text(key, field.label)
  if (typeof field.description === 'string' && field.description) out.description = text(`${key}.help`, field.description)
  if (typeof field.placeholder === 'string' && field.placeholder) out.placeholder = text(`${key}.placeholder`, field.placeholder)
  if (typeof field.emptyLabel === 'string' && field.emptyLabel) out.emptyLabel = text(`${key}.empty`, field.emptyLabel)
  if (Array.isArray(field.options)) {
    // a plain-string option is its own value and label: it becomes `{ value, label }` only when its label is translated
    out.options = field.options.map((o) => {
      if (typeof o === 'string') {
        const label = text(`${key}.option.${labelIdSlug(o)}`, o)
        return label === o ? o : { value: o, label }
      }
      return isObject(o) && typeof o.label === 'string' && o.label && o.value !== undefined
        ? { ...o, label: text(`${key}.option.${labelIdSlug(String(o.value))}`, o.label) }
        : o
    })
  }
  if (isObject(field.fields)) out.fields = localizeFields(field.fields, key, text)
  if (isObject(field.variants) && isObject(field.variants.cases)) {
    const cases = field.variants.cases
    out.variants = {
      ...field.variants,
      cases: Object.fromEntries(Object.entries(cases).map(([c, f]) => [c, f === null ? null : localizeField(f, `${key}.case.${labelIdSlug(c)}`, text)])),
    }
  }
  return out
}

/** A schema's fields (`{ name: FieldSchema }`) with their texts under `<prefix>.field.<name>`. */
export function localizeFields<T>(schema: T, prefix: string, text: LabelText): T {
  if (!isObject(schema) || text === englishLabels) return schema
  return Object.fromEntries(Object.entries(schema).map(([name, f]) => [name, localizeField(f, `${prefix}.field.${labelIdSlug(name)}`, text)])) as T
}

/** Data slots (`dataSpec`) with their labels under `<prefix>.slot.<key>`. */
export function localizeSlots<T extends { key: string; label: string }>(slots: readonly T[], prefix: string, text: LabelText): T[] {
  return slots.map((s) => (typeof s.label === 'string' && s.label ? { ...s, label: text(`${prefix}.slot.${labelIdSlug(s.key)}`, s.label) } : s))
}

/** Events (`actionSources`) with their labels under `<prefix>.action.<name>`. */
export function localizeActions<T extends { name: string; label: string }>(actions: readonly T[], prefix: string, text: LabelText): T[] {
  return actions.map((a) => (typeof a.label === 'string' && a.label ? { ...a, label: text(`${prefix}.action.${labelIdSlug(a.name)}`, a.label) } : a))
}

/** A command's label and its parameters' texts (`<m>.dashboardCommand.<local key>`). */
export function localizeCommand<C extends { key: string; label: string; paramsSchema: unknown }>(command: C, moduleId: string, text: LabelText): C {
  if (text === englishLabels) return command
  const prefix = commandLabelKey(moduleId, command.key)
  return { ...command, label: text(prefix, command.label), paramsSchema: localizeFields(command.paramsSchema, prefix, text) }
}

/** Every key a command's catalogue entry is shown through, with its English (for the owning module's test of its dictionaries). */
export function commandLabelMessages(moduleId: string, command: { key: string; label: string; paramsSchema: unknown }): Record<string, string> {
  const out: Record<string, string> = {}
  localizeCommand(command, moduleId, (key, english) => { out[key] = english; return english })
  return out
}

/**
 * Every key a module.json declares for the dashboard, with its English (the manifest's widgets, its `dashboard:widget` contributions'
 * names, settings, slots and events, its `dashboard:data_source` group names, and the shelf of a module with a widget that names no
 * category: every manifest widget, a contribution without `metadata.category`). The extractor
 * builds the same map from the file; the parity test compares the two. Countables, commands and contributed categories are code, not
 * manifest, and are checked by their modules' own tests.
 */
export function manifestLabelMessages(moduleId: string, manifest: { widgets?: unknown; extensions?: unknown }): Record<string, string> {
  const out: Record<string, string> = {}
  const record: LabelText = (key, english) => { out[key] = english; return english }
  const widgets = Array.isArray(manifest.widgets) ? manifest.widgets : []
  for (const w of widgets) {
    if (isObject(w) && typeof w.id === 'string' && typeof w.name === 'string' && w.name) record(widgetLabelKey(moduleId, w.id), w.name)
  }
  let shelf = widgets.length > 0
  for (const e of Array.isArray(manifest.extensions) ? manifest.extensions : []) {
    if (!isObject(e) || typeof e.key !== 'string') continue
    const md = isObject(e.metadata) ? e.metadata : {}
    if (e.point === 'dashboard:widget') {
      if (typeof md.category !== 'string' || !md.category) shelf = true
      const prefix = widgetLabelKey(moduleId, e.key)
      if (typeof md.label === 'string' && md.label) record(explicitLabelKey(md.labelKey, moduleId) ?? prefix, md.label)
      if (isObject(md.schema)) localizeFields(md.schema, prefix, record)
      if (Array.isArray(md.dataSpec)) localizeSlots(md.dataSpec.filter((s): s is { key: string; label: string } => isObject(s) && typeof s.key === 'string'), prefix, record)
      if (Array.isArray(md.actionSources)) localizeActions(md.actionSources.filter((a): a is { name: string; label: string } => isObject(a) && typeof a.name === 'string'), prefix, record)
    } else if (e.point === 'dashboard:data_source') {
      if (typeof md.label === 'string' && md.label) record(explicitLabelKey(md.labelKey, moduleId) ?? dataSourceLabelKey(moduleId, e.key), md.label)
    }
  }
  if (shelf) record(widgetShelfKey(moduleId), codeWords(moduleId))
  return out
}
