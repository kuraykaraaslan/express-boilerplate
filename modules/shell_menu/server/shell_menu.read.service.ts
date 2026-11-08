import redis from '@kuraykaraaslan-labs/redis';
import Logger from '@kuraykaraaslan-labs/logger';
import { getDataSource } from '@kuraykaraaslan-labs/db';
import { ShellMenu } from './entities/shell_menu.entity';
import type { MenuSpec } from './shell_menu.schema';

// The published menu on every admin page load (docs/phases/54-menu-editor, 01): an in-process copy keyed by a version
// kept in Redis, so a page load costs one Redis GET and no query in steady state, and a publish on any process shows on
// every process at its next page load. Redis down: the copy. Database down with no copy: no menu (the package
// defaults), which reveals nothing: the registry's permission filter runs before any menu layer.

export const VERSION_KEY = 'shell_menu:version';

export type PublishedMenu = { spec: MenuSpec; revision: number };

type Copy = { version: string | null; value: PublishedMenu | null; at: number };

let copy: Copy | null = null;
let lastFailureLog = 0;

/** Without Redis, re-read at most this often. */
const NO_REDIS_TTL_MS = 5_000;

async function currentVersion(): Promise<string | null | undefined> {
  try {
    return await redis.get(VERSION_KEY);
  } catch {
    return undefined; // Redis down: the caller keeps its copy
  }
}

async function loadPublished(): Promise<PublishedMenu | null> {
  const ds = await getDataSource();
  const row = await ds.getRepository(ShellMenu).findOne({ where: { state: 'published' } });
  return row ? { spec: row.spec, revision: row.revision } : null;
}

/** Bump the version every process compares against: after a publish, a restore or an import has committed. */
export async function bumpMenuVersion(revision: number): Promise<void> {
  copy = null;
  try {
    await redis.set(VERSION_KEY, `${revision}:${Date.now()}`);
  } catch (err) {
    Logger.warn(`[shell_menu] version bump failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export default class ShellMenuReadService {
  /** The published menu, or null when none is published (or it cannot be read and no copy exists). */
  static async published(): Promise<PublishedMenu | null> {
    const version = await currentVersion();
    const now = Date.now();
    if (copy && version !== undefined && copy.version === version) return copy.value;
    if (copy && version === undefined && now - copy.at < NO_REDIS_TTL_MS) return copy.value;
    try {
      const value = await loadPublished();
      copy = { version: version ?? null, value, at: now };
      return value;
    } catch (err) {
      if (now - lastFailureLog > 60_000) {
        lastFailureLog = now;
        Logger.error(`[shell_menu] the published menu could not be read: ${err instanceof Error ? err.message : String(err)}`);
      }
      return copy?.value ?? null;
    }
  }

  /** For tests: forget the in-process copy. */
  static resetCopy(): void {
    copy = null;
  }
}
