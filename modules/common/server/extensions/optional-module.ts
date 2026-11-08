import { contributorState } from './contributor-state';

/**
 * How a module reaches a module it lists in `dependencies.optional` (EXT-14, docs/phases/37-extensions/10).
 *
 * Optional means "calls it when it is there": the code is loaded with `import()` only when the other module is active
 * for this tenant, and the caller gets `null` otherwise and degrades (no live chat, no auto-assignment, no metric). Being
 * in the build is not enough: a module the workspace switched off, or the platform banned, must not be written to or
 * called on its behalf. A module this build does not have at all also answers `null`.
 *
 * The registry snapshot accepts an `import()` of an optional module and refuses a static one; this is the call site
 * that makes the `import()` honest.
 */
export async function ifActive<T>(tenantId: string, moduleId: string, load: () => Promise<T>): Promise<T | null> {
  if ((await contributorState(tenantId, moduleId)).state !== 'active') return null;
  try {
    return await load();
  } catch (error) {
    // Only a module missing from this build is a quiet "not here"; anything else is the caller's failure to see.
    if (isModuleNotFound(error)) return null;
    throw error;
  }
}

function isModuleNotFound(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND';
}
