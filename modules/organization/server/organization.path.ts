import type { Repository, ObjectLiteral } from 'typeorm'
import { Like } from 'typeorm'

/**
 * Materialised-ancestry maintenance, shared by every tree in this module.
 *
 * A path like `/GY/SAT/IST` turns "everything under this node" into one
 * `LIKE 'path/%'` index scan instead of a recursive CTE. Two trees now need
 * that — cost centers and teams — and copying the algorithm into the second
 * service is exactly what AGENTS.md §10.0/4 forbids: the copy drifts, and the
 * two trees start disagreeing about what a subtree is.
 *
 * Generic over the entity so both callers pass their own repository and primary
 * key name; the rules themselves live here once.
 */

export interface PathNode extends ObjectLiteral {
  path: string
  code: string
}

/** `/CODE` for a root, `<parent.path>/CODE` otherwise. */
export async function buildPath<T extends PathNode>(
  repo: Repository<T>,
  tenantId: string,
  code: string,
  parentId: string | null,
  parentKey: string,
  onParentMissing: () => never,
): Promise<string> {
  if (!parentId) return `/${code}`
  const parent = await repo.findOne({ where: { tenantId, [parentKey]: parentId } as never })
  if (!parent) onParentMissing()
  return `${(parent as PathNode).path}/${code}`
}

/**
 * Would re-parenting `node` under `parent` create a cycle?
 *
 * True when the proposed parent IS the node or sits beneath it. Both cases
 * produce a path that can never be reached from the root, so the check runs
 * BEFORE anything is written rather than leaving a corrupt tree behind.
 */
export function wouldCycle(nodePath: string, parentPath: string): boolean {
  return parentPath === nodePath || parentPath.startsWith(`${nodePath}/`)
}

/**
 * Swap `oldPath` for `newPath` at the head of every descendant's path.
 *
 * Matches `${oldPath}/%` and never `${oldPath}%`: the latter would also catch a
 * sibling whose code merely starts with the same letters (`/SAT` would drag in
 * `/SATIS`), silently re-parenting an unrelated subtree.
 */
/**
 * A path as a LIKE prefix that matches only its real descendants (organization.04).
 * `%`, `_` and `\` in a code are literals, not wildcards: without the escape the
 * subtree of `/GY_SAT` also returned `/GYXSAT/...`, and renaming a node whose code
 * is `%` rewrote every path of the tenant.
 */
export function descendantsLike(path: string): string {
  return `${path.replace(/[\\%_]/g, (c) => `\\${c}`)}/%`
}

export async function rewriteDescendants<T extends PathNode>(
  repo: Repository<T>,
  tenantId: string,
  oldPath: string,
  newPath: string,
): Promise<number> {
  const descendants = await repo.find({
    where: { tenantId, path: Like(descendantsLike(oldPath)) } as never,
  })
  for (const row of descendants) {
    (row as PathNode).path = `${newPath}${(row as PathNode).path.slice(oldPath.length)}`
  }
  if (descendants.length) await repo.save(descendants as never)
  return descendants.length
}
