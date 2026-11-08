/**
 * A kind of custom menu link another module offers (docs/phases/54-menu-editor, 09): the dashboard's `board` first. The
 * sysadmin picks a target of that kind in Platform → Menu; at each page load the contributor turns it into a link for
 * the viewer's tenant, or into nothing. `shell_menu` imports nothing of the contributor; the contributor imports only
 * this contract.
 */
export const SHELL_MENU_LINK_TARGET_POINT = 'shell_menu:link_target';

/** Who is looking, as far as a contributor needs to know. */
export interface LinkTargetViewer {
  tenantId: string;
  userId: string | null;
  role: 'sysadmin' | 'owner' | 'admin' | 'user' | null;
}

export interface LinkTargetSuggestion {
  target: string;
  label: string;
  /** A short line under the label (e.g. "installed by the Water site solution"). */
  hint?: string;
}

export interface LinkTargetProvider {
  /** The link kind (`board`): lowercase, at most 32 characters; must not be `page` or `url`. */
  kind: string;
  /** The kind's name in the editor, English. */
  label: string;
  /** Targets to offer in the editor's picker for a search text. */
  suggest(q: string): Promise<LinkTargetSuggestion[]>;
  /** Why a target is refused, or null. */
  validate(target: string): string | null;
  /**
   * For each target, the tenant-relative `/admin/…` path the viewer may open, or null to show no link. Called once per
   * page load with every target of this kind; must not reveal anything the viewer could not open by URL.
   */
  resolve(viewer: LinkTargetViewer, targets: string[]): Promise<Record<string, string | null>>;
}
