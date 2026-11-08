// The field vocabulary every schema-driven form in the repo shares: a field's
// TYPE, its descriptor, and the two compound value shapes a descriptor can
// carry. Extracted from dynamic_page (2026-08-21) because three separately
// sellable consumers describe forms this way -- the page builder's props panel,
// tenant_setting's module settings pages, and the dashboard widget platform --
// which is the one part of the block/widget overlap that passes the AGENTS.md
// §10.1 test. The BLOCK types (BlockDefinition, BlockVariant) stay in
// dynamic_page: they carry a React Component and a page-layout preset, neither
// of which a settings form has any use for.
// Plan: docs/phases/07-dashboard/04-editor-and-library.md



export type FieldType =
  | 'text' | 'url' | 'textarea' | 'color' | 'boolean' | 'number'
  | 'select' | 'multi-select' | 'json' | 'img' | 'repeater'
  | 'icon' | 'rich-text' | 'datetime'
  // Date-only (no time-of-day component) — `<input type="date">`. `datetime`
  // above is date+time (`datetime-local`); a block or settings form that only
  // needs a calendar day used to have to overload `datetime` for that, which
  // asked the visitor for a time nobody would fill in correctly.
  | 'date'
  | 'link' | 'color-token' | 'background'
  // Picks a reusable symbol from the tenant's library (stores its symbolId).
  | 'symbol'
  // Library-backed image: browse/reuse the tenant media library (media_gallery),
  // upload into it, edit alt text and a focal point. Value is a string URL
  // (legacy) OR a MediaValue object — renderers resolve both via resolveMedia().
  // Falls back to plain URL/upload behaviour when media_gallery is disabled.
  | 'media'
  // Generic picker over a tenant API endpoint (any module): fetches `endpoint`,
  // lists items by `labelKey`, stores `valueKey`. Optionally offers an empty
  // ("all") option and a "Dynamic — from URL" option that stores ':slug'
  // (resolved at render by useDynamicValue). Reusable — not commerce-specific.
  | 'remote-select'

export type FieldOption = string | { label: string; value: string }

// Breakpoint-aware responsive prop: scalar OR per-device object
export type ResponsiveValue<T = unknown> = T | { mobile?: T; tablet?: T; desktop?: T }

// Value type for 'link' compound field
export interface LinkValue {
  label: string
  href: string
  target: '_self' | '_blank'
}

export interface FieldSchema {
  label: string
  type: FieldType
  value?: unknown
  options?: FieldOption[]
  placeholder?: string
  uploadFolder?: string
  accept?: string
  description?: string
  required?: boolean
  min?: number
  max?: number
  step?: number
  showIf?: Record<string, unknown | unknown[]>
  group?: string
  /**
   * For the exotic case, folded under "Advanced" by the forms that know the fold (a dashboard card's data parameters: an element filter, a
   * group, a readable-table switch); a form that does not know the fold draws it as any field. Presentation only (e2e round 3, M-R3-04).
   */
  advanced?: boolean
  /**
   * Never drawn by any form (dashboard phase 45.8, K1): a setting a program writes (a scene's element map, a 2D import's report) and
   * a person must not see or edit. Its stored value stays and travels through `onChange` untouched. kui-react's `FieldSchema` carries
   * the same flag (its SchemaForm filters it); every form of this repo that draws a `FieldSchema` map filters it too, and a test per
   * form pins that. Not `showIf` (a condition on other values) and not `deprecated` (still shown read-only while it holds a value).
   */
  hidden?: boolean
  fields?: Record<string, FieldSchema>
  // When true, PropFieldRenderer shows M/T/D breakpoint tabs
  responsive?: boolean
  // ── 'remote-select' options ────────────────────────────────────────────────
  /** Tenant-relative API path the picker fetches, e.g. '/api/storefront/categories'. */
  endpoint?: string
  /** Key in the JSON response holding the array (e.g. 'categories'); omit if the response IS the array. */
  dataKey?: string
  /** Item field used as the option label (default 'name'). */
  labelKey?: string
  /** Item field stored as the value (default 'id'). */
  valueKey?: string
  /**
   * Makes a `remote-select` searchable (dashboard phase 17.1): the name of the query parameter that
   * carries the search text (e.g. `q`). The picker then asks the endpoint for a short page per
   * keystroke instead of loading everything, so it works for an entity list too large to load whole.
   * An identifier, never a URL part. kui-react's `FieldSchema` carries the same key (3313f3b); the picker
   * itself stays in this repo (`ui/schema-form/fields/searchable-remote-select.component.tsx`) because it calls
   * the tenant API.
   */
  searchKey?: string
  /**
   * With `searchKey`: the query parameter that resolves one stored value to its row (e.g. `id`), so a
   * deep-linked or reloaded value shows its label rather than the raw id, and a value that no longer
   * exists is reported as not found. Without it the label comes from what this page has already seen.
   */
  lookupKey?: string
  /** Label for the empty/"all" option; omit to not offer one. */
  emptyLabel?: string
  /** When true, offers a "Dynamic — from URL" option that stores ':slug'. */
  allowDynamic?: boolean
  /**
   * Next-boilerplate's own (dashboard phase 49a, AD-06): a `text` field holding a comma list of an entity type's keys (a device's
   * telemetry keys), picked by name from the keys the dashboard's entity keys route lists for `entityType`, of `keyType` only.
   * `subtypeFrom` names the field of the same form whose value is the subtype the keys are narrowed to (a device profile); `max` caps
   * the count. The stored value stays the comma list, so a host that does not know the hint shows the text box.
   */
  entityKeys?: { entityType: string; keyType: 'field' | 'attribute' | 'telemetry'; subtypeFrom?: string; max?: number }
  /**
   * Next-boilerplate's own (an RPC catalog command, e2e run 1, K2): the field's schema depends on the value of the sibling `by` (the
   * control a `scada.set_value` sets): `cases[<that value>]` is the field for it (a switch's yes / no, a set-point's number in its
   * range), `null` when that choice sends no value (a button). A value with no case keeps the declared field. The RPC params check
   * applies the case; a form that does not know the hint draws the declared type.
   */
  variants?: { by: string; cases: Record<string, FieldSchema | null> }
}

/**
 * Whether a field's `showIf` condition holds against the current values.
 * Lives with FieldSchema because `showIf` is one of its fields: a descriptor and
 * the rule that reads it are the same piece of knowledge.
 */
export function shouldShow(field: FieldSchema, values: Record<string, unknown>): boolean {
  if (!field.showIf) return true
  return Object.entries(field.showIf).every(([k, v]) =>
    Array.isArray(v) ? v.includes(values[k]) : values[k] === v,
  )
}
