// Runtime module lifecycle-hook runner. Resolves a module's onInstall /
// onUninstall / … handler through the generated `module-hooks` lazy-import map
// and invokes it. Best-effort: a hook failure is logged but never re-thrown, so
// it can never block (or roll back) the marketplace install / uninstall that
// triggered it. Server-only — dynamic-imports handler code, kept React-free.
//
// This is the lifecycle twin of `extension-registry`: modules declare handlers
// in module.json `hooks`, the build resolves them into `module-hooks.ts`, and the
// marketplace install/purge flow calls `runModuleHook` here without importing any
// module directly.

import Logger from '@kuraykaraaslan-labs/logger';
import { moduleHooks, type ModuleHookFn } from './generated/module-hooks';

export type ModuleHookEvent = 'onInstall' | 'onUninstall' | 'onEnable' | 'onDisable' | 'onUpgrade';

export interface ModuleHookContext {
  tenantId: string;
}

/**
 * Run a module's lifecycle hook for `event`, if it declares one. A no-op when the
 * module has no handler for that event. Never throws — lifecycle hooks seed or
 * clean best-effort content (default pages, projections, sample rows) and must
 * not fail the install/uninstall they hang off. Handlers are expected to be
 * idempotent (safe to re-run on repeated installs).
 */
export async function runModuleHook(
  moduleId: string,
  event: ModuleHookEvent,
  ctx: ModuleHookContext,
): Promise<void> {
  const loader = moduleHooks[`${moduleId}:${event}`];
  if (!loader) return;
  try {
    const fn: ModuleHookFn = await loader();
    await fn(ctx);
  } catch (err) {
    Logger.warn(`[module-hooks] ${moduleId}.${event} failed: ${(err as Error)?.message ?? err}`);
  }
}
