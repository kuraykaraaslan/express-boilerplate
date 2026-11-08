import { fork } from 'node:child_process';
import cluster from 'node:cluster';
import type { SpawnChild } from './supervisor.core';
import { procEnv } from './supervisor.env';

/**
 * How a supervisor starts its children: the **one** spawn implementation of process_host, used by the Redis-backed
 * supervisor (`startSupervisor`) and the credential-less local one (`startLocalSupervisor`). Pure Node: no env schema,
 * logger or Redis, so the local supervisor can load it.
 *
 * - `cluster: false` (`forkSpawn`): plain `child_process.fork` children, each with its own ports (worker, automation-worker,
 *   telephony-gateway).
 * - `cluster: true` (`clusterSpawn`): `node:cluster` workers with the supervisor as the **cluster primary** (07 "Kind-specific
 *   notes", task 7). A worker's `server.listen(port)` gets a handle the primary owns and hands each new connection to the
 *   next worker (round-robin, `SCHED_RR`, on every platform), so a kind whose clients reach one address runs several
 *   processes behind it: ws on `WS_PORT` (4001), the script host on 4012, the plugin host on 4500. The supervisor itself
 *   must not listen on that port: it serves its own `/healthz` and `/metrics` on a separate one. A worker that closes its
 *   server stops receiving new connections (its open ones stay), which is how a draining child leaves the rotation.
 *
 * Either way the handle is a `ChildProcess` with the IPC channel, so the supervisor protocol (`ready`, `signal`, `cpu`,
 * `drain` …) and `runAsChild` work unchanged: for a cluster worker its `message` event carries only user messages, cluster's
 * own traffic goes to `internalMessage`.
 */
export interface SpawnOptions {
  /** The child entry (usually the calling entry itself). */
  entry: string;
  args?: string[];
  /** Node flags of the children; defaults to this process's (so a `tsx` parent forks `tsx` children). */
  execArgv?: string[];
  /** The child's environment additions (the child markers, `childEnv`), merged over this process's environment. */
  env: (index: number) => Record<string, string | undefined>;
}

const STDIO: ['ignore', 'inherit', 'inherit', 'ipc'] = ['ignore', 'inherit', 'inherit', 'ipc'];

/** Plain forked children (each opens its own ports). */
export function forkSpawn(o: SpawnOptions): SpawnChild {
  return (index) => fork(o.entry, o.args ?? [], {
    execArgv: o.execArgv ?? process.execArgv,
    // the inherited environment plus the additions (the Next-augmented `ProcessEnv` type insists on NODE_ENV, which the spread carries)
    env: { ...procEnv(), ...o.env(index) } as unknown as NodeJS.ProcessEnv,
    stdio: STDIO,
  });
}

/** `node:cluster` workers sharing their listening ports through this process (the cluster primary). */
export function clusterSpawn(o: SpawnOptions): SpawnChild {
  if (!cluster.isPrimary) throw new Error('[process_host] a cluster supervisor must be the cluster primary');
  // round-robin in the primary on every platform (Linux's default; Windows would otherwise leave it to the OS). Frozen by
  // the first fork, so it is set here, before any.
  cluster.schedulingPolicy = cluster.SCHED_RR;
  return (index) => {
    cluster.setupPrimary({ exec: o.entry, args: o.args ?? [], execArgv: o.execArgv ?? process.execArgv, stdio: STDIO });
    // cluster merges the additions over this process's environment itself
    return cluster.fork(o.env(index)).process;
  };
}

/** The supervisors' spawn: cluster workers sharing the service port, or plain forks. */
export const spawnChildren = (o: SpawnOptions & { cluster: boolean }): SpawnChild => (o.cluster ? clusterSpawn(o) : forkSpawn(o));
