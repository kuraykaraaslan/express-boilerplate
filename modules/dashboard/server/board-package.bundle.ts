import { z } from 'zod'
import {
  BoardPackageSchema, collectReferences, mapOpenBoardTargets, packageVersionProblem, type PackageVersionProblem,
  type BoardPackage, type SkippedPlacement,
} from './board-package'

/**
 * The board bundle (phase 19.6): one document that carries 1 to `MAX_BUNDLE_BOARDS` board packages,
 * so a board and the boards its `openBoard` actions open can move together.
 *
 * Each member is an ordinary board package (the single-board format, unchanged and still importable
 * on its own) with a bundle-local `ref`. An `openBoard` whose target is another member is written
 * as that member's ref instead of the exporting tenant's board id; on import every member is
 * created first and those refs are rewritten to the new boards' ids. A target outside the bundle
 * keeps its board id and is resolved exactly as in a single import (kept if a board with that id
 * exists here for the caller, otherwise reported and dropped).
 *
 * The ref is uuid-shaped (`00000000-0000-4000-8000-<12 digits>`) on purpose: an `openBoard` keeps
 * passing the very action schema a stored placement passes, and the fixed prefix can never be
 * mistaken for a real (random v4) board id. It is a label inside one file, never a database id.
 * `boards[0]` is the board the export started from.
 */
export const BOARD_BUNDLE_FORMAT = 'dashboard-board-bundle'
export const BOARD_BUNDLE_VERSION = 1
export const SUPPORTED_BUNDLE_VERSIONS = [1] as const
export const MAX_BUNDLE_BOARDS = 20

const BUNDLE_REF_PREFIX = '00000000-0000-4000-8000-'
const BUNDLE_REF_RE = /^00000000-0000-4000-8000-[0-9]{12}$/

/** The n-th (1-based) bundle-local ref. */
export const bundleRef = (n: number) => `${BUNDLE_REF_PREFIX}${String(n).padStart(12, '0')}`
export const isBundleRef = (v: unknown): v is string => typeof v === 'string' && BUNDLE_REF_RE.test(v)

export const BundleMemberSchema = z
  .object({
    ref: z.string().regex(BUNDLE_REF_RE, 'Invalid bundle board ref'),
    package: BoardPackageSchema,
  })
  .strict()
export type BundleMember = z.infer<typeof BundleMemberSchema>

export const BoardBundleSchema = z
  .object({
    format: z.literal(BOARD_BUNDLE_FORMAT),
    bundleVersion: z.literal(1),
    exportedAt: z.string().datetime(),
    boards: z.array(BundleMemberSchema).min(1).max(MAX_BUNDLE_BOARDS),
  })
  .strict()
  .refine((b) => new Set(b.boards.map((m) => m.ref)).size === b.boards.length, {
    message: 'Bundle board refs must be unique',
    path: ['boards'],
  })
export type BoardBundle = z.infer<typeof BoardBundleSchema>

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Does this (unparsed) document claim to be a bundle? Decides which schema the import parses it with. */
export const isBundleDocument = (raw: unknown): boolean => isPlainObject(raw) && raw.format === BOARD_BUNDLE_FORMAT

/**
 * Before the strict parse, like `packageVersionProblem`: a bundle from a newer bundle format, or one
 * whose members come from a newer package format, gets a clear message (`null` = readable).
 */
export function bundleVersionProblem(raw: unknown): PackageVersionProblem | null {
  if (!isBundleDocument(raw)) return null
  const doc = raw as Record<string, unknown>
  const v = doc.bundleVersion
  if (typeof v === 'number' && Number.isInteger(v) && !(SUPPORTED_BUNDLE_VERSIONS as readonly number[]).includes(v)) {
    return v > BOARD_BUNDLE_VERSION
      ? { newer: true, message: `This dashboard bundle was exported by a newer version (bundle format ${v}); update this app to import it.` }
      : { newer: false, message: `This bundle format (${v}) is not supported.` }
  }
  for (const m of Array.isArray(doc.boards) ? doc.boards : []) {
    const problem = packageVersionProblem(isPlainObject(m) ? m.package : undefined)
    if (problem) return problem
  }
  return null
}

/** A board the linked export did not take, and why. Reported next to the bundle, never inside it. */
export interface LeftOutBoard { boardId: string; reason: 'not_visible' | 'cap' }

/** A placement left out of one member, with the member it belongs to. */
export type BundleSkippedPlacement = SkippedPlacement & { board: string }

/**
 * Collect a board and, transitively, every board its `openBoard` actions reach (breadth first, the
 * start board first), as far as `load` returns them and up to `cap` boards. `load` is the caller's
 * visibility: it returns the built package of a board the exporter may open, or null (someone else's
 * private board, another tenant's board, a board that is gone: never told apart, so nothing leaks).
 * A target over the cap or not visible stays an external link and is listed in `leftOut`.
 */
export async function collectLinkedBoards(
  startBoardId: string,
  load: (boardId: string) => Promise<{ package: BoardPackage; skipped: SkippedPlacement[] } | null>,
  cap = MAX_BUNDLE_BOARDS,
): Promise<{ members: Array<{ boardId: string; package: BoardPackage; skipped: SkippedPlacement[] }>; leftOut: LeftOutBoard[] }> {
  const start = startBoardId.toLowerCase()
  const first = await load(start)
  if (!first) throw new Error('The start board must be loadable')
  const members = [{ boardId: start, ...first }]
  const seen = new Set([start])
  const leftOut: LeftOutBoard[] = []
  for (let i = 0; i < members.length; i++) {
    for (const target of members[i].package.references.boards) {
      if (seen.has(target)) continue
      seen.add(target)
      if (members.length >= cap) { leftOut.push({ boardId: target, reason: 'cap' }); continue }
      const built = await load(target)
      if (built) members.push({ boardId: target, ...built })
      else leftOut.push({ boardId: target, reason: 'not_visible' })
    }
  }
  return { members, leftOut }
}

/**
 * Turn collected boards into a bundle: each gets the ref of its position, and every `openBoard` to
 * another member is rewritten to that member's ref (its `references.boards` follows). Pure.
 */
export function buildBoardBundle(args: {
  members: Array<{ boardId: string; package: BoardPackage; skipped: SkippedPlacement[] }>
  now?: Date
}): { bundle: BoardBundle; skipped: BundleSkippedPlacement[] } {
  const refOf = new Map(args.members.map((m, i) => [m.boardId.toLowerCase(), bundleRef(i + 1)]))
  const skipped: BundleSkippedPlacement[] = []
  const boards = args.members.map((m, i) => {
    const ref = bundleRef(i + 1)
    for (const s of m.skipped) skipped.push({ ...s, board: ref })
    const placements = m.package.placements.map((p) => {
      if (!p.actions) return p
      const actions = mapOpenBoardTargets(p.actions, (id) => refOf.get(id) ?? id)
      return actions === p.actions ? p : { ...p, actions }
    })
    return { ref, package: { ...m.package, placements, references: collectReferences(placements) } }
  })
  return {
    bundle: {
      format: BOARD_BUNDLE_FORMAT,
      bundleVersion: BOARD_BUNDLE_VERSION,
      exportedAt: (args.now ?? new Date()).toISOString(),
      boards,
    },
    skipped,
  }
}

/** A file name for a bundle download: like a package's, with `.boards.json`. */
export function bundleFileName(title: string): string {
  const slug = title.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  return `${slug || 'dashboard'}.boards.json`
}
