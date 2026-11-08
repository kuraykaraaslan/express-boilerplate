// Standalone plugin-host process — runs untrusted plugin code in V8 isolates,
// SEPARATE from the Next/backend tier so an OOM/crash here never takes down the app.
//
// IMPORTANT: this process holds NO db/storage credentials. It reaches data only via
// the web-tier broker (over token-auth HTTP, see broker-client). Start it with
// `--no-node-snapshot` (required by isolated-vm on modern Node) — the npm scripts do.
//
//   npm run plugin-host:dev   |   npm run plugin-host:start
//
// `PROC_PLUGIN_HOST_ENABLED=true` makes this process the supervisor of kind `plugin-host`
// (docs/phases/14-docker/07 task 7): `node:cluster` children of this entry share PLUGIN_HOST_PORT and are
// scaled by the wait for a free sandbox; see host/plugin-host.process.ts.
//
// No top-level await: the root package is CommonJS for tsx, so run-sidecar's readable mode loads this entry as CJS.

import { runPluginHostProcess } from './host/plugin-host.process';
import { loadRuntimeConfig } from './rpc/protocol';

runPluginHostProcess({ cfg: loadRuntimeConfig(), env: process.env, entry: process.argv[1] }).catch((error: unknown) => {
  console.error(`[plugin-host] failed to start: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exit(1);
});
