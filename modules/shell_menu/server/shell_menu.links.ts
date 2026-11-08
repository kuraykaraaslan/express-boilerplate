import Logger from '@kuraykaraaslan-labs/logger';
import { moduleRegistry } from '@kuraykaraaslan-labs/common/server/module-registry';
import { ext, systemCtx, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext';
import { shellMenuLinkTargetLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/shell_menu.link_target';
import type { ShellLink } from '@kuraykaraaslan-labs/app_shell/ui/shell-profile';
import { linkText, type LabelText, type MenuViewer } from './shell_menu.profile';
import { pagePath, pageTargetProblem, urlTargetProblem, type MenuRole, type MenuSpec } from './shell_menu.schema';
import { SHELL_MENU_LINK_TARGET_POINT, type LinkTargetProvider } from './shell_menu.link-targets.types';

// Custom menu links for one viewer (docs/phases/54-menu-editor, 09). A link never grants anything: a page link shows
// only where the page guard opens the page, an outside link only to its audience, a contributed link only where its
// contributor resolves it for the viewer's tenant. Everything is decided again at each page load.

const ROLE_RANK: Record<MenuRole, number> = { user: 1, admin: 2, owner: 3, sysadmin: 4 };

/** What the layout knows about the request. */
export type LinkContext = {
  tenantId: string;
  userId: string | null;
  viewer: MenuViewer;
  locale: string;
  /** Modules on for the tenant. */
  enabled: ReadonlySet<string>;
  /** Which of these permissions the viewer holds, by the page guard's decision. */
  granted: (permissionIds: string[]) => Promise<ReadonlySet<string>>;
  text: LabelText;
};

function meetsRole(role: MenuRole | null, minRole: MenuRole | undefined): boolean {
  if (!minRole) return true;
  return role !== null && ROLE_RANK[role] >= ROLE_RANK[minRole];
}

/** An outside address with its placeholders filled for the viewer. */
export function fillUrl(target: string, ctx: { tenantId: string; locale: string }): string {
  return target.replaceAll('{tenantId}', encodeURIComponent(ctx.tenantId)).replaceAll('{locale}', encodeURIComponent(ctx.locale));
}

/** The contributed link kinds, by kind. A provider that fails to load is left out (its links show nowhere). */
export async function linkTargetProviders(tenantId?: string): Promise<Map<string, LinkTargetProvider>> {
  const out = new Map<string, LinkTargetProvider>();
  try {
    const { loaded } = await ext.loadAll<LinkTargetProvider>(
      SHELL_MENU_LINK_TARGET_POINT,
      tenantId ? tenantCtx(tenantId) : systemCtx('shell_menu editor: the link kinds modules offer'),
      shellMenuLinkTargetLoaders,
    );
    for (const { impl } of loaded) {
      if (impl && typeof impl.kind === 'string' && impl.kind !== 'page' && impl.kind !== 'url' && !out.has(impl.kind)) out.set(impl.kind, impl);
    }
  } catch (err) {
    Logger.warn(`[shell_menu] link kinds unavailable: ${err instanceof Error ? err.message : String(err)}`);
  }
  return out;
}

/** The page route behind a tenant-relative admin path, with its guard, when the page is on for the tenant. */
function guardOf(path: string, ctx: LinkContext): string[] | null {
  if (pageTargetProblem(path)) return null;
  const match = moduleRegistry.findPageRoute(pagePath(path), { tenantId: ctx.tenantId });
  if (!match || !ctx.enabled.has(match.route.moduleId) || !match.route.guard?.length) return null;
  return match.route.guard;
}

/** The links of `spec` the viewer gets, labelled in their language, in the spec's order. */
export async function resolveLinks(spec: MenuSpec, ctx: LinkContext): Promise<ShellLink[]> {
  const entries = Object.entries(spec.links ?? {}).filter(([, l]) => meetsRole(ctx.viewer.role, l.audience?.minRole));
  if (!entries.length) return [];

  // 1. Contributed kinds answer a tenant-relative path per target (or nothing).
  const contributed = new Map<string, string[]>();
  for (const [, link] of entries) {
    if (link.kind !== 'page' && link.kind !== 'url') contributed.set(link.kind, [...(contributed.get(link.kind) ?? []), link.target]);
  }
  const resolved = new Map<string, Record<string, string | null>>();
  if (contributed.size) {
    const providers = await linkTargetProviders(ctx.tenantId);
    await Promise.all([...contributed].map(async ([kind, targets]) => {
      const provider = providers.get(kind);
      if (!provider) return;
      try {
        resolved.set(kind, await provider.resolve({ tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.viewer.role }, [...new Set(targets)]));
      } catch (err) {
        Logger.warn(`[shell_menu] ${kind} links not resolved: ${err instanceof Error ? err.message : String(err)}`);
      }
    }));
  }

  // 2. Every in-app link, a page link or a resolved contributed one, needs its page's guard: one decision for all.
  const candidates = new Map<string, { href: string; guard: string[] | null }>();
  const needed = new Set<string>();
  for (const [id, link] of entries) {
    if (link.audience?.permission) needed.add(link.audience.permission);
    if (link.kind === 'url') continue;
    const href = link.kind === 'page' ? link.target : resolved.get(link.kind)?.[link.target] ?? null;
    if (!href) continue;
    const guard = guardOf(href, ctx);
    if (!guard) continue;
    candidates.set(id, { href, guard });
    for (const p of guard) needed.add(p);
  }
  let granted: ReadonlySet<string> = new Set();
  if (needed.size) {
    try {
      granted = await ctx.granted([...needed]);
    } catch {
      granted = new Set(); // fail closed: no permission-bound link shows
    }
  }

  const out: ShellLink[] = [];
  for (const [id, link] of entries) {
    if (link.audience?.permission && !granted.has(link.audience.permission)) continue;
    let href: string | null = null;
    if (link.kind === 'url') {
      // No audience, no link (the schema refuses it too).
      if ((link.audience?.minRole || link.audience?.permission) && !urlTargetProblem(link.target)) href = fillUrl(link.target, ctx);
    } else {
      const c = candidates.get(id);
      if (c?.guard && c.guard.every((p) => granted.has(p))) href = c.href;
    }
    if (!href) continue;
    out.push({
      id,
      label: linkText(ctx.text, id, link.label),
      href,
      external: link.kind === 'url',
      ...(link.icon ? { icon: link.icon } : {}),
      ...(link.group ? { group: link.group } : {}),
      ...(link.workspace ? { workspace: link.workspace } : {}),
      order: link.order ?? 1000,
    });
  }
  return out;
}
