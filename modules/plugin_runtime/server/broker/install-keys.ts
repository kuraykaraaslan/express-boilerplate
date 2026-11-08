// Neutral setting-key helpers for per-tenant community-plugin install markers.
// Lives in plugin_runtime (the generic runtime) with NO marketplace import, so both
// the marketplace (writer) and the runtime resolver (reader) can share them without
// creating a runtime→marketplace dependency.

export const communityInstallKeys = {
  version: (listingId: string) => `plugin.community.${listingId}.version`,
  active: (listingId: string) => `plugin.community.${listingId}.active`,
  /**
   * `'release' | 'test'` (roadmap 09-internal-testing.md). Absent =
   * `'release'` — every install written before this key existed stays exactly
   * as it behaved, no backfill required.
   */
  channel: (listingId: string) => `plugin.community.${listingId}.channel`,
};

// ── Operator-installed local plugins (plugin_local, OD-139) ──────────────────
// A second bundle source writes the same `installs` ledger (artifactType 'plugin')
// with a namespaced artifact id, and its own settings projection, so neither source
// can read or clear the other's rows: `listingId`s are bare uuids, local ids are
// `local:<pluginId>`; the community projection is `plugin.community.*`, the local
// one `plugin.local.*`. Readers that enumerate every plugin row of a tenant skip
// the other source's rows with `isLocalPluginArtifact`.

export const LOCAL_PLUGIN_ARTIFACT_PREFIX = 'local:';

/** The `installs.artifactId` of a local plugin (its LocalPlugin.pluginId uuid, namespaced). */
export const localPluginArtifactId = (pluginId: string): string => `${LOCAL_PLUGIN_ARTIFACT_PREFIX}${pluginId}`;

/** True for a ledger row a local plugin wrote (not a marketplace listing). */
export const isLocalPluginArtifact = (artifactId: string): boolean => artifactId.startsWith(LOCAL_PLUGIN_ARTIFACT_PREFIX);

/**
 * The runtime plugin id (`SandboxConfig.pluginId`) of a local plugin: it namespaces its plugin_kv rows, settings,
 * secrets and storage. A marketplace scoped name always starts with `@`, so `local/…` can never name a marketplace plugin.
 */
export const localRuntimePluginId = (scopedName: string): string => `local/${scopedName}`;

export const localInstallKeys = {
  prefix: (pluginId: string) => `plugin.local.${pluginId}.`,
  version: (pluginId: string) => `plugin.local.${pluginId}.version`,
  active: (pluginId: string) => `plugin.local.${pluginId}.active`,
};
