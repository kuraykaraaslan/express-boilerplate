/**
 * What a board renders of a tenant-authored widget is its PUBLISHED snapshot, not
 * the live row (phase 15.4a). Editing a published widget writes the next draft on
 * the live row; without this overlay a keystroke in the editor reached every board
 * on the next catalog refresh, which is exactly what the publish step exists to
 * prevent. Import-light on purpose: no DataSource, so the catalog can use it in a
 * unit test.
 */
export const DEFINITION_FIELDS = [
  'type', 'label', 'category', 'renderTier', 'template', 'defaultW', 'defaultH',
  'schema', 'defaultProps', 'dataSpec', 'icon', 'defaultDataBinding',
  // 21.8: the settings template placements follow is the published one (the live row's equal it, as
  // only publish writes them; a snapshot from before 21.8 has neither and keeps the live values).
  'settingsTemplate', 'settingsMigrations',
] as const

/** The row with its definition fields taken from the snapshot; identity, status and ownership stay live. */
export function applyPublishedSnapshot<T extends object>(row: T, snapshot: object | null | undefined): T {
  if (!snapshot) return row
  const out: Record<string, unknown> = { ...(row as Record<string, unknown>) }
  const snap = snapshot as Record<string, unknown>
  for (const f of DEFINITION_FIELDS) if (f in snap && snap[f] !== undefined) out[f] = snap[f]
  return out as T
}

/**
 * The row as a PINNED placement sees it (7b): every definition field from the pinned snapshot, never its
 * identity, status, revision, owner or visibility (a whole-snapshot spread carried those back to their
 * publish-time values). A snapshot from before 21.8 has no template line: the pinned version is then the
 * v1 baseline with no steps (`null`), not the live row's later line.
 */
export function applyPinnedSnapshot<T extends object>(row: T, snapshot: object | null | undefined): T {
  if (!snapshot) return row
  const out: Record<string, unknown> = { ...(row as Record<string, unknown>) }
  const snap = snapshot as Record<string, unknown>
  for (const f of DEFINITION_FIELDS) {
    if (f === 'settingsTemplate' || f === 'settingsMigrations') out[f] = snap[f] ?? null
    else if (f in snap && snap[f] !== undefined) out[f] = snap[f]
  }
  return out as T
}

/**
 * Whether a placement may still render this row. A PUBLISHED widget renders; an
 * ARCHIVED one that was published once keeps rendering on the boards that already
 * carry it (archiving only retires it from the library); a DRAFT never does, which
 * also makes `unpublish` the explicit way to take a widget off live boards.
 */
export function rendersOnBoards(row: { status?: string; publishedVersion?: number | null }): boolean {
  return row.status === 'PUBLISHED' || (row.status === 'ARCHIVED' && row.publishedVersion != null)
}
