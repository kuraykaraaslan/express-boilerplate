/**
 * The `dashboard:widget_kinds` seam (docs/phases/07-dashboard/28, tasks 28.1 and 28.3).
 *
 * The widget kit tags some builtin kinds with a product GROUP (`BuiltinKindSpec.group`, e.g. `scada` on `scada.symbol` and
 * `scada.scene`). A module that sells such a group contributes to this point with `key` = the group id. The dashboard keeps
 * drawing, validating and storing those kinds itself (the kit is vendored there); the group only decides WHETHER they are
 * available to a tenant:
 *
 *   - the catalogue read (the picker, the library) leaves the kinds of a group without an active contributor out;
 *   - a placement create / update, a preset of such a kind and its publish are refused with 422 `WIDGET_KIND_UNAVAILABLE`;
 *   - a placement that is already stored stays intact and renders an inert "this widget is not available" card.
 *
 * "Without an active contributor" includes "no contributor at all" (the module is not in the build, or switched off for the
 * tenant). A kind with no group is never gated.
 *
 * The contribution's `metadata` is documentation only: `category` names the picker category the kinds are filed under;
 * `types` may list the kinds for a reader but nothing decides by it. The same record is the contribution's default export
 * (a contract test holds the two together).
 *
 * One part of it is read, and only while the group is active for the tenant: the scene a kind of the group draws (phase 42.5, D42-12). A
 * builtin kind that draws a scene bound to its page's subject (the process diagram) declares it with the same keys an `ext:` widget declares it
 * with in its own metadata (`ext-widget.ts` `SceneContract`): `sceneType` (which kind of the group), `sceneKind`, `sceneDocumentSetting`,
 * `sceneOwnedSettings`. The dashboard then resolves the scene of such a card at board open (`scene-binding.open.ts`) and refuses the owned
 * settings in a card overlay, without knowing the kind. One scene kind per group (the metadata is flat: a point's `metadataSchema` has no objects).
 */

export const WIDGET_KINDS_POINT = 'dashboard:widget_kinds'

export interface WidgetKindGroup {
  /** Documentation only: the builtin kind types the group's module sells. The kit's `group` tag decides, not this list. */
  types?: string[]
  /** The kind of the group that draws a scene, and the scene contract it declares (see above); the same record as the contribution's `metadata`. */
  sceneType?: string
  sceneKind?: string
  sceneDocumentSetting?: string
  sceneOwnedSettings?: string[]
  /** The picker category those kinds are filed under (a core category, or one a module contributes). */
  category: string
}
