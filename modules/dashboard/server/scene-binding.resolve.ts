/**
 * Which binding answers for a subject (docs/phases/07-dashboard/42, D42-5), as pure logic: the caller loads the rows, this picks one.
 *
 *  1. the subject's own row, whatever its status (an `unresolved` row answers as such: falling through to another scene would hide
 *     that the binding broke);
 *  2. a device without a row: the nearest ancestor asset row whose `devices` names this device (the ancestor walk is the caller's,
 *     nearest first), with the device's role to focus; an asset without a row: its single device's row when it holds exactly one
 *     device, else the nearest ancestor asset's row (a floor or a room under a bound building: the hierarchy binds at the top, D42-6,
 *     and the view is derived from where the asset sits) BUT ONLY when a view (a level or a room) can be derived from that row (a utility
 *     asset below a building that holds no level or room of its own has nothing to look at: the whole building focused on nothing is no
 *     answer), otherwise a placeholder — never a guess for two or more devices;
 *  3. the card's own default, when the card has one.
 *
 * So the order is, for an asset: own > single-device > ancestor-with-derivable-view > placeholder (the card default only for an asset that
 * holds exactly one device); for a device: own > ancestor-naming-the-device > card default.
 *
 * The answer says which rung answered, so a card menu can say "site scene" or "board default".
 */
import type { SceneBindingStatus } from './scene-binding.types'

/** The part of a binding row the resolver reads. */
export interface ResolvableBinding {
  subjectType: string
  subjectId: string
  slot: string
  kind: string
  devices: Record<string, string>
  status: SceneBindingStatus
}

export type SceneRung = 'subject' | 'ancestor' | 'single-device' | 'card-default' | 'placeholder'

export interface SceneResolution<B extends ResolvableBinding = ResolvableBinding> {
  rung: SceneRung
  binding?: B
  /** At rung `ancestor` for a device: the role of the asset's row that names this device, which the card focuses. `""` is the main role. */
  focusRole?: string
  /** At rung `ancestor`: how far up the walk the answering row is (0 = the nearest ancestor), for the caller to work the page's view out. */
  ancestorIndex?: number
}

export interface ResolveInput<B extends ResolvableBinding = ResolvableBinding> {
  subject: { type: string; id: string }
  slot: string
  kind: string
  /** The subject's own row, when it has one. */
  own: B | null
  /** Rows of the subject's ancestor assets that have one, nearest first. */
  ancestors?: B[]
  /**
   * For an asset subject: the ids of the devices it holds (the caller's walk), and the row of the single one when it holds exactly
   * one. A device subject passes neither.
   */
  deviceIds?: string[]
  singleDeviceRow?: B | null
  /**
   * For an asset subject: whether a view (a level or a room) can be derived from the nearest ancestor row (the caller's `deriveViewOf`, which
   * reads the row's document). False = that row does not answer for the asset. Absent counts as true (a caller that derives no views).
   */
  ancestorHasView?: boolean
  /** The card has a default scene of its own (its settings), used when nothing above answers. */
  cardDefault: boolean
}

const ASSET_TYPE = 'iot_asset'
const DEVICE_TYPE = 'iot_device'

/** The role of `row` that names `deviceId` (the first by role name), or undefined. */
export function roleOf(row: Pick<ResolvableBinding, 'devices'>, deviceId: string): string | undefined {
  const id = deviceId.toLowerCase()
  return Object.keys(row.devices).sort().find((role) => row.devices[role].toLowerCase() === id)
}

const sameScene = (b: ResolvableBinding, slot: string, kind: string): boolean => b.slot === slot && b.kind === kind

export function resolveSceneBinding<B extends ResolvableBinding>(input: ResolveInput<B>): SceneResolution<B> {
  const { subject, slot, kind } = input
  if (input.own && sameScene(input.own, slot, kind)) return { rung: 'subject', binding: input.own }

  if (subject.type === DEVICE_TYPE) {
    const rows = input.ancestors ?? []
    for (let i = 0; i < rows.length; i++) {
      if (!sameScene(rows[i], slot, kind)) continue
      const role = roleOf(rows[i], subject.id)
      if (role !== undefined) return { rung: 'ancestor', binding: rows[i], focusRole: role, ancestorIndex: i }
    }
  } else if (subject.type === ASSET_TYPE) {
    const ids = input.deviceIds ?? []
    // exactly one device: its own row answers (a plant's own drawing is the more specific scene)
    if (ids.length === 1 && input.singleDeviceRow && sameScene(input.singleDeviceRow, slot, kind)) return { rung: 'single-device', binding: input.singleDeviceRow }
    // a floor or a room under a bound building shows the building's document; which part of it is the page's view (`deriveView`)
    const at = (input.ancestors ?? []).findIndex((row) => sameScene(row, slot, kind))
    if (at >= 0 && input.ancestorHasView !== false) return { rung: 'ancestor', binding: input.ancestors![at], ancestorIndex: at }
    // two or more devices (or none) and no row above: which drawing is a decision of a person, never a guess
    if (ids.length !== 1) return { rung: 'placeholder' }
  }

  return input.cardDefault ? { rung: 'card-default' } : { rung: 'placeholder' }
}
