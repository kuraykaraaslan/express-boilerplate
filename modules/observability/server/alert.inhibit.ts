/**
 * Dependency-aware inhibition (observability phase 11).
 *
 * Alertmanager inhibits by matching label sets, but it cannot know that the API depends on the database. We own that knowledge: the
 * status components and the process kinds are a graph. An edge says "`child` cannot be healthy while `parent` is down". While any
 * ancestor of an alert's entity has a firing alert, the child's alert is SUPPRESSED (and says which one inhibits it), and returns to
 * FIRING when the ancestor recovers.
 *
 * Entities are opaque keys: `component:<id>`, `process:<kind>`, `monitor:<id>`.
 */

export interface DependencyEdge { child: string; parent: string }

const MAX_DEPTH = 10

/** Direct parents of an entity. */
function parentsOf(edges: readonly DependencyEdge[], entity: string): string[] {
  return edges.filter((e) => e.child === entity).map((e) => e.parent)
}

/** Would adding `child → parent` close a loop? (including a self edge) */
export function wouldCycle(edges: readonly DependencyEdge[], child: string, parent: string): boolean {
  if (child === parent) return true
  // A loop appears when `child` is already an ancestor of `parent`.
  const seen = new Set<string>()
  const stack = [parent]
  while (stack.length > 0) {
    const cur = stack.pop() as string
    if (cur === child) return true
    if (seen.has(cur)) continue
    seen.add(cur)
    for (const p of parentsOf(edges, cur)) stack.push(p)
  }
  return false
}

/**
 * The nearest ancestor of any of `entities` that has a firing alert, or null. Breadth-first so the reason names the closest cause, and
 * bounded in depth so a bad graph cannot make the pipeline spin (cycles are refused at write time; this is the second line).
 */
export function inhibitingEntity(
  edges: readonly DependencyEdge[], entities: readonly string[], firingEntities: ReadonlySet<string>,
): string | null {
  const seen = new Set<string>(entities)
  let frontier = [...entities]
  for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0; depth += 1) {
    const next: string[] = []
    for (const entity of frontier) {
      for (const parent of parentsOf(edges, entity)) {
        if (firingEntities.has(parent)) return parent
        if (!seen.has(parent)) { seen.add(parent); next.push(parent) }
      }
    }
    frontier = next
  }
  return null
}

/** The entity keys an alert speaks for: its `entity` label (comma separated when it covers several). */
export function entitiesOf(labels: Readonly<Record<string, string>>): string[] {
  const raw = labels.entity ?? ''
  return raw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20)
}
