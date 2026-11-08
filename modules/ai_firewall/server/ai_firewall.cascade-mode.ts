/**
 * The request cascade's mode as the activity page states it (docs/phases/55-ai-firewall/04-tree-models.md 4.7, 4.8; FWD-12). A stage is
 * promoted when the promotion store says so for the model file this process loaded, no owner holds it, the gate re-checked it lately and
 * the two files are the pair their independence was measured on (`promotedStages`, D55-128, D55-130). Pure.
 *
 *   no stage loaded                                 -> off       (only the deterministic rule floor acts)
 *   one stage loaded                                -> shadow    (the cascade records what it would do, every request is allowed)
 *   both loaded, not both promoted                  -> shadow
 *   both promoted, a kill switch holds or unreadable -> shadow   (`kill_switch`: the platform's switch, or ROOT's for the platform's runs)
 *   both loaded and both promoted                   -> enforcing (a block needs both keys, FWA-13)
 *
 * A tenant's own kill switch and off apply per request in the cascade itself (4.8), not to this platform-wide mode.
 */
import type { CascadeModeView, ShippedModelName } from './ai_firewall.activity.types';

export type StageState = { readonly loaded: boolean; readonly promoted: boolean };

export function cascadeMode(stages: Readonly<Record<ShippedModelName, StageState>>, options: { readonly killSwitch?: boolean } = {}): CascadeModeView {
  const { behaviour, attack } = stages;
  if (!behaviour.loaded && !attack.loaded) return { mode: 'off', reason: 'no_model' };
  if (!behaviour.loaded || !attack.loaded) return { mode: 'shadow', reason: 'one_stage' };
  if (!behaviour.promoted || !attack.promoted) return { mode: 'shadow', reason: 'not_promoted' };
  if (options.killSwitch) return { mode: 'shadow', reason: 'kill_switch' };
  return { mode: 'enforcing', reason: 'promoted' };
}
