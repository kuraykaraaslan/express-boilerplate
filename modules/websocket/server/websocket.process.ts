import { env } from '@kuraykaraaslan-labs/env';
import { runAsChild, shouldSupervise, startSupervisor } from '@kuraykaraaslan-labs/process_host/server/supervisor';
import { WS_PROCESS_KIND } from './websocket.node-registry';

/**
 * The `ws` process (`npm run ws:start`, the `ws` image; docs/phases/14-docker/07 task 7).
 *
 * - `PROC_WS_ENABLED=true`: this process is the **supervisor** of kind `ws` and the `cluster` primary. It forks children of
 *   its own entry (`process.argv[1]`: `scripts/run-sidecar.mjs` in an image, the entry file under tsx) that all listen on
 *   `WS_PORT` through `cluster` (round-robin), and serves the group's `/healthz` and `/metrics` on `WS_SUPERVISOR_PORT`.
 *   It scales them by the children's load ratio (`websocket.scaling.ts`; policy `ws` in process_host). It loads none of
 *   the gateway: Socket.IO, the descriptors and Redis exist in the children only.
 * - otherwise, and in every child: the gateway itself (`bootstrap`), exactly as before when unsupervised.
 *
 * Long-polling is off (`transports: ['websocket']` in the gateway and in every client): a polling client's requests would
 * be spread over the children and need sticky routing; with websocket-only one TCP connection is one child for its life.
 */
export type WsProcessRole = 'supervisor' | 'child' | 'single';

export async function runWsProcess(): Promise<WsProcessRole> {
  if (shouldSupervise(WS_PROCESS_KIND)) {
    const wsPort = env.WS_PORT ?? env.MESSAGING_WS_PORT;
    const port = env.WS_SUPERVISOR_PORT;
    if (port === wsPort) {
      throw new Error(`[websocket] WS_SUPERVISOR_PORT (${port}) must differ from WS_PORT: the children share WS_PORT through cluster, the supervisor cannot listen on it`);
    }
    await startSupervisor({ kind: WS_PROCESS_KIND, entry: process.argv[1], port, cluster: true });
    return 'supervisor';
  }
  return runAsChild(WS_PROCESS_KIND, async (ctx) => {
    const { bootstrap } = await import('./gateway');
    await bootstrap(ctx.isChild ? ctx : undefined);
    return ctx.isChild ? 'child' : 'single';
  });
}
