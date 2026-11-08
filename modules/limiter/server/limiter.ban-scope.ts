/**
 * Where an IP ban holds (decision D55-3, docs/phases/55-ai-firewall/00-wire-existing-controls.md 0.2). No imports, so the proxy's ban gate
 * and the strike store share it without the gate loading the store (and its audit and database imports).
 */
export type IpBanScope = 'auth' | 'everywhere';

/**
 * From which offense an automatic ban holds everywhere (D55-3). The first automatic ban of an address stays on the sign-in endpoints: one
 * office behind one NAT that mistyped ten passwords in ten minutes keeps its pages and its signed-in sessions; a repeat offense within the
 * offense memory (30 days) is no accident and blocks the whole site.
 */
export const BAN_EVERYWHERE_FROM_OFFENSE = 2;

/** Whether a ban is enforced by the proxy's gate on every route (D55-3); otherwise only the sign-in endpoints refuse it. */
export function banHoldsEverywhere(ban: { offense: number; manual: boolean; source?: string; scope?: string }): boolean {
  if (ban.scope === 'auth') return false;
  if (ban.scope === 'everywhere') return true;
  return ban.manual === true || ban.source === 'manual' || ban.source === 'firewall' || Number(ban.offense) >= BAN_EVERYWHERE_FROM_OFFENSE;
}
