import { z } from 'zod'

/**
 * A placement's compute script (phase 35.5, ADR-0017, POSTURE §14): `transform` derives what a card draws from the
 * data it loaded, the board parameters, the window and the clock, and nothing else. It is a PLACEMENT field (E3):
 * not a setting (settings are validated against the widget's template, POSTURE §6, which strips it) and not a
 * definition column (§2: a definition carries `template`, never `script`). The text is stored as it is and the host
 * never evaluates it: it runs in a Worker inside the compute frame (`dashboard-compute-frame.route.ts`), whose
 * policy gives it nothing to reach, and its result comes back as data the host validates (`transform-output.ts`).
 *
 * The script is an ES module whose default export is a pure, synchronous function; `TRANSFORM_CONTRACT_EXAMPLE`
 * is the shape the editor shows. It returns `{ slots }`: the slots the view draws, each replacing the loaded one; a
 * slot it does not return stays as loaded. It never acts (E1): there is no message for a parameter write, a command
 * or a navigation, so the closed action set of POSTURE §8 is untouched. A script for a scene card (`scada.scene`,
 * `viewer.model`) may return a scene patch beside its slots (35.5b, `transform-output.ts`): drawing instructions, never an action.
 */

/** The script text is bounded: 64 KiB of characters, stored as text, never evaluated host-side. */
export const MAX_TRANSFORM_SCRIPT_CHARS = 65_536
/** A run's wall-clock budget in the Worker; past it the Worker is terminated and recreated on the next input (E4). */
export const TRANSFORM_DEFAULT_TIMEOUT_MS = 50
export const TRANSFORM_MIN_TIMEOUT_MS = 10
export const TRANSFORM_MAX_TIMEOUT_MS = 500
/** What the card shows after a failed run: the previous output, or nothing. */
export const TRANSFORM_ON_ERROR = ['keep', 'empty'] as const
export type TransformOnError = (typeof TRANSFORM_ON_ERROR)[number]

export const TransformSchema = z
  .object({
    v: z.literal(1),
    enabled: z.boolean(),
    script: z.string().max(MAX_TRANSFORM_SCRIPT_CHARS),
    timeoutMs: z.number().int().min(TRANSFORM_MIN_TIMEOUT_MS).max(TRANSFORM_MAX_TIMEOUT_MS).optional(),
    onError: z.enum(TRANSFORM_ON_ERROR),
  })
  .strict()
export type Transform = z.infer<typeof TransformSchema>

/** What a placement write accepts: a transform, or `null` to clear it. */
export const PlacementTransformSchema = TransformSchema.nullable()

/**
 * A package may carry a script longer than a placement stores (a file written by hand, or by a later version with a
 * higher cap): the import then DROPS the transform and reports it (`importTransform`), like a settings part over its
 * cap. The package bound keeps a hostile file from carrying anything unbounded; past it the whole file is refused.
 */
export const MAX_PACKAGE_TRANSFORM_SCRIPT_CHARS = MAX_TRANSFORM_SCRIPT_CHARS * 4
export const PackageTransformSchema = TransformSchema.extend({ script: z.string().max(MAX_PACKAGE_TRANSFORM_SCRIPT_CHARS) }).strict()

/** A transform the host runs: enabled, with a script that is not blank. Anything else is as if there were none. */
export function isActiveTransform(t: unknown): t is Transform {
  const parsed = TransformSchema.safeParse(t)
  return parsed.success && parsed.data.enabled && parsed.data.script.trim().length > 0
}

/** The budget a transform runs under: its own, else the default. */
export function transformTimeoutMs(t: Pick<Transform, 'timeoutMs'> | null | undefined): number {
  return t?.timeoutMs ?? TRANSFORM_DEFAULT_TIMEOUT_MS
}

/**
 * A package placement's transform as the import plan stores it (pure): kept as text when it fits a placement, dropped
 * with the reason when it does not (the file is over the placement cap, or malformed in a way the package schema let
 * through). Nothing is repaired inside the script: the host never reads it.
 */
export function importTransform(raw: unknown): { transform: Transform | null; problem: string | null } {
  if (raw === undefined || raw === null) return { transform: null, problem: null }
  const parsed = TransformSchema.safeParse(raw)
  if (parsed.success) return { transform: parsed.data, problem: null }
  const length = typeof (raw as { script?: unknown }).script === 'string' ? (raw as { script: string }).script.length : null
  return {
    transform: null,
    problem: length !== null && length > MAX_TRANSFORM_SCRIPT_CHARS
      ? `the card's transform script (${length} characters) is over the ${MAX_TRANSFORM_SCRIPT_CHARS}-character limit and was dropped`
      : 'the card\'s transform was not in a shape this app stores and was dropped',
  }
}

/**
 * The transform a display link's screen gets (`display-safe.ts`): the stored one when the screen will run it (it is
 * enabled and well-formed), else null. A screen runs it through the display compute frame, which needs no session.
 */
export function displayTransform(raw: unknown): Transform | null {
  return isActiveTransform(raw) ? raw : null
}

/** The contract as the editor shows it (the plan's example, phase 35 §B.5): positions in, one thing per object out. */
export const TRANSFORM_CONTRACT_EXAMPLE = `export default function transform({ slots, params, window, now }) {
  // slots:  the bound data by slot key, as the source returned it (shape table | scalar | series | record)
  // params: the effective board parameters of the card's frame (read-only)
  // window: { from, to, interval? } (ms since the epoch) when the card's data ran with a window
  // now:    ms since the epoch, the host's clock (a script never reads Date)
  // A process diagram or a 3D model may also return scene: { things, objects, links, shapes, view, problems }: drawing only.
  const rows = slots.positions?.rows ?? [];
  const inRoom = rows.filter((r) => r.room === params.room);
  return { slots: { things: { shape: 'table', columns: [{ key: 'id' }, { key: 'kind' }, { key: 'x' }, { key: 'y' }, { key: 'label' }],
                             rows: inRoom.map((r) => ({ id: r.tag, kind: 'person', x: r.x, y: r.y, label: \`\${inRoom.length} in room\` })) } } };
}`
