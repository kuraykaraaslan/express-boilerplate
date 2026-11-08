import { readFileSync, readdirSync, readlinkSync, mkdirSync, renameSync, writeFileSync, unlinkSync } from 'node:fs';
import { availableParallelism, hostname, totalmem } from 'node:os';
import { join } from 'node:path';
import type { BudgetSource, ScalingPolicy } from './supervisor.types';
import { procEnv, type EnvSource } from './supervisor.env';

/**
 * The machine budget (07 "How many children at most").
 *
 * CPU and memory come from the container's cgroup, never from `os.cpus()` alone: inside Docker that reports the host's
 * cores and the supervisor would oversubscribe. Order: cgroup v2 (`cpu.max`, `memory.max`), cgroup v1
 * (`cpu.cfs_quota_us` / `cpu.cfs_period_us`, `memory.limit_in_bytes`), then the host (`os.availableParallelism()`,
 * `os.totalmem()`). A limit is never above what the host has.
 */

export interface MachineLimits {
  /** Whole cores the process may use (a fractional quota rounds down, at least 1). */
  cores: number;
  memoryMb: number;
  source: BudgetSource;
  /** True when a cgroup limit is below what the host has (the budget is this container's own, not the host's). */
  limited?: boolean;
}

export interface BudgetIo {
  readFile: (path: string) => string | null;
  hostCores: () => number;
  hostMemoryMb: () => number;
}

const tryRead = (path: string): string | null => {
  try { return readFileSync(path, 'utf8'); } catch { return null; }
};

export const nodeBudgetIo: BudgetIo = {
  readFile: tryRead,
  hostCores: () => availableParallelism(),
  hostMemoryMb: () => Math.floor(totalmem() / 1024 / 1024),
};

/** cgroup v2 `cpu.max`: `"max 100000"` (unlimited) or `"<quota> <period>"`. Returns cores (fractional) or null. */
export function parseCpuMaxV2(text: string | null): number | null {
  if (!text) return null;
  const [quota, period] = text.trim().split(/\s+/);
  if (!quota || quota === 'max') return null;
  const q = Number(quota);
  const p = Number(period ?? 100_000);
  if (!Number.isFinite(q) || !Number.isFinite(p) || q <= 0 || p <= 0) return null;
  return q / p;
}

/** cgroup v1 quota/period in µs; a quota of -1 is unlimited. */
export function parseCpuV1(quotaText: string | null, periodText: string | null): number | null {
  if (!quotaText) return null;
  const q = Number(quotaText.trim());
  const p = Number((periodText ?? '100000').trim());
  if (!Number.isFinite(q) || q <= 0 || !Number.isFinite(p) || p <= 0) return null;
  return q / p;
}

/**
 * A memory limit in bytes → MB. `max` (v2) and the v1 "no limit" sentinel (a page-aligned value near 2^63) are
 * unlimited (null). Anything at or above 2^60 bytes is treated as unlimited.
 */
export function parseMemoryLimit(text: string | null): number | null {
  if (!text) return null;
  const t = text.trim();
  if (!t || t === 'max') return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0 || n >= 2 ** 60) return null;
  return Math.floor(n / 1024 / 1024);
}

/** The process's own cgroup v2 path from `/proc/self/cgroup` (`0::/some/path`), when not namespaced to `/`. */
export function ownCgroupV2Path(procSelfCgroup: string | null): string | null {
  if (!procSelfCgroup) return null;
  const line = procSelfCgroup.split('\n').find((l) => l.startsWith('0::'));
  const path = line?.slice(3).trim();
  return path && path !== '/' ? path : null;
}

export function readMachineLimits(io: BudgetIo = nodeBudgetIo, root = '/sys/fs/cgroup'): MachineLimits {
  const hostCores = Math.max(1, io.hostCores());
  const hostMem = Math.max(1, io.hostMemoryMb());
  let cpu: number | null = null;
  let mem: number | null = null;
  let source: BudgetSource = 'host';

  // v2: the namespaced root first (a container), then the process's own cgroup (a systemd slice on a bare host)
  const v2Dirs = [root];
  const own = ownCgroupV2Path(io.readFile('/proc/self/cgroup'));
  if (own) v2Dirs.push(join(root, own));
  for (const dir of v2Dirs) {
    const cpuText = io.readFile(join(dir, 'cpu.max'));
    const memText = io.readFile(join(dir, 'memory.max'));
    if (cpuText === null && memText === null) continue;
    source = 'cgroup-v2';
    cpu ??= parseCpuMaxV2(cpuText);
    mem ??= parseMemoryLimit(memText);
  }
  if (source === 'host') {
    const quota = io.readFile(join(root, 'cpu', 'cpu.cfs_quota_us')) ?? io.readFile(join(root, 'cpu,cpuacct', 'cpu.cfs_quota_us'));
    const period = io.readFile(join(root, 'cpu', 'cpu.cfs_period_us')) ?? io.readFile(join(root, 'cpu,cpuacct', 'cpu.cfs_period_us'));
    const memV1 = io.readFile(join(root, 'memory', 'memory.limit_in_bytes'));
    if (quota !== null || memV1 !== null) {
      source = 'cgroup-v1';
      cpu = parseCpuV1(quota, period);
      mem = parseMemoryLimit(memV1);
    }
  }
  const cores = Math.max(1, Math.min(hostCores, cpu === null ? hostCores : Math.floor(cpu + 1e-9)));
  const memoryMb = Math.min(hostMem, mem ?? hostMem);
  return { cores, memoryMb, source, limited: cores < hostCores || memoryMb < hostMem };
}

export interface Reserve {
  cores: number;
  memoryMb: number;
}

/** `PROC_RESERVED_CORES` (default 1) and `PROC_RESERVED_MB` (default 256). */
export function reserveFromEnv(env: EnvSource = procEnv()): Reserve {
  const num = (v: string | undefined, d: number) => {
    const n = v === undefined || v === '' ? NaN : Number(v);
    return Number.isFinite(n) && n >= 0 ? n : d;
  };
  return { cores: num(env.PROC_RESERVED_CORES, 1), memoryMb: num(env.PROC_RESERVED_MB, 256) };
}

export interface ChildBudget {
  /** Cores children may use. */
  cpu: number;
  /** MB children may use. */
  memoryMb: number;
  source: BudgetSource;
  /** The machine limits were a container's own (see `MachineLimits.limited`); its budget is shared with nobody outside it. */
  limited?: boolean;
}

export function childBudget(limits: MachineLimits, reserve: Reserve): ChildBudget {
  return {
    cpu: Math.max(0, Math.floor(limits.cores - reserve.cores)),
    memoryMb: Math.max(0, Math.floor(limits.memoryMb - reserve.memoryMb)),
    source: limits.source,
    ...(limits.limited && { limited: true }),
  };
}

/**
 * `max(kind) = min(policy.max, cpuBudget, floor(memoryBudget / childMemoryMb), naturalCeiling)`, never below `min`
 * (the minimum is a promise of the policy; a machine too small for it still runs it).
 */
export function kindMax(policy: Pick<ScalingPolicy, 'min' | 'max' | 'naturalCeiling' | 'childMemoryMb'>, budget: Pick<ChildBudget, 'cpu' | 'memoryMb'>): number {
  const byMem = policy.childMemoryMb > 0 ? Math.floor(budget.memoryMb / policy.childMemoryMb) : Infinity;
  const ceiling = policy.naturalCeiling ?? Infinity;
  const m = Math.min(policy.max, budget.cpu, byMem, ceiling);
  return Math.max(policy.min, Number.isFinite(m) ? m : policy.min);
}

// ── Shared machine budget across kinds ───────────────────────────────────────

/** Lower is served first: users notice `ws`/`telephony-gateway` at once, `worker` (cron and queues) last. */
export const KIND_PRIORITY: Record<string, number> = {
  ws: 0,
  'telephony-gateway': 0,
  'automation-worker': 1,
  'script-host': 2,
  'plugin-host': 2,
  worker: 3,
};
export const DEFAULT_PRIORITY = 4;
export const priorityOf = (kind: string): number => KIND_PRIORITY[kind] ?? DEFAULT_PRIORITY;

/** One supervisor's claim on the machine budget (one file per kind and PID namespace in the ledger directory). */
export interface BudgetClaim {
  kind: string;
  pid: number;
  /**
   * The PID namespace the writer runs in (`ownNamespace()`): `pid` means something only to a reader in the same one.
   * Absent in a claim written before it existed, which is read as the reader's own.
   */
  ns?: string;
  /**
   * The budget the claim draws from: `host` when the writer's budget is the whole host (no container limit), otherwise
   * its own namespace (a limited container's children count against that container only). Claims of another pool are
   * not part of the split. Absent = `host`.
   */
  pool?: string;
  priority: number;
  min: number;
  /** The kind's own max (`kindMax`). */
  max: number;
  childMemoryMb: number;
  /** How many children the supervisor wants right now (current, +1 while its up condition holds). */
  wants: number;
  updatedAt: number;
}

/**
 * Splits the budget between the kinds on one machine. Pure and deterministic: every supervisor computes it from the
 * same claims and gets the same answer, so they agree without Redis and without a lock.
 *
 *  1. every kind gets its `min` (always, even over budget);
 *  2. the rest is handed out in priority order (then kind name), each kind up to `min(wants, max)`, while CPU and
 *     memory remain.
 *
 * A kind that wants nothing beyond its minimum holds nothing beyond it, so an idle high-priority kind does not
 * starve the others; when it wants more, the lower kinds' allocations shrink and they drain down to them.
 */
export function splitBudget(claims: readonly BudgetClaim[], budget: Pick<ChildBudget, 'cpu' | 'memoryMb'>): Map<string, number> {
  const sorted = [...claims].sort((a, b) => {
    const ka = claimKey(a);
    const kb = claimKey(b);
    return a.priority - b.priority || (ka < kb ? -1 : ka > kb ? 1 : 0);
  });
  const out = new Map<string, number>();
  let cpu = budget.cpu;
  let mem = budget.memoryMb;
  for (const c of sorted) {
    const base = Math.min(c.min, c.max);
    out.set(claimKey(c), base);
    cpu -= base;
    mem -= base * c.childMemoryMb;
  }
  for (const c of sorted) {
    let n = out.get(claimKey(c))!;
    const target = Math.min(Math.max(c.wants, c.min), c.max);
    while (n < target && cpu >= 1 && mem >= c.childMemoryMb) {
      n += 1;
      cpu -= 1;
      mem -= c.childMemoryMb;
    }
    out.set(claimKey(c), n);
  }
  return out;
}

/**
 * What identifies a claim in the split: its kind, plus its namespace when it has one, so the same kind supervised in
 * two containers sharing one ledger holds two claims (`worker@pid:[4026532201]`).
 */
export const claimKey = (c: Pick<BudgetClaim, 'kind' | 'ns'>): string => (c.ns ? `${c.kind}@${c.ns}` : c.kind);

/**
 * This process's PID namespace (`/proc/self/ns/pid` → `pid:[4026531836]`), or `host:<hostname>` where there is no
 * procfs. Two containers on one host have different ones unless they share the host's (`pid: host`), in which case
 * their PIDs do mean the same process to each other.
 */
export function ownNamespace(readLink: (path: string) => string = readlinkSync, host: () => string = hostname): string {
  try {
    const link = readLink('/proc/self/ns/pid');
    if (link) return link;
  } catch { /* no procfs */ }
  return `host:${host()}`;
}

/**
 * The ledger the supervisors of one machine share: a directory with one JSON file per kind and PID namespace, each
 * written only by its own supervisor (write to a temp file + rename, so a reader never sees a torn file). A claim that
 * was not refreshed for `staleMs` is ignored; so is one from the reader's own PID namespace whose process is gone. A
 * claim from another namespace (another container sharing the directory) is judged by its age alone: its `pid` would
 * name an unrelated process, or none, in the reader's namespace. No lock is needed because no file has two writers and
 * the split is a pure function of the claims.
 *
 * By default the directory is `/tmp/nb-proc-budget`, which inside a container is the container's own, so a container
 * sees only its own kinds: right when it has its own cgroup limits. Containers on one host without limits share one
 * directory (`PROC_BUDGET_DIR` on a shared volume, infra/compose/docker-compose.node.yml) so their supervisors split the
 * host between them instead of each sizing for all of it.
 */
export class BudgetLedger {
  constructor(
    private readonly dir: string = procEnv().PROC_BUDGET_DIR || '/tmp/nb-proc-budget',
    private readonly staleMs = 30_000,
    private readonly alive: (pid: number) => boolean = pidAlive,
    /** This process's PID namespace (`ownNamespace()`), stamped on the claims it writes. */
    readonly ns: string = ownNamespace(),
  ) {}

  private file(kind: string): string {
    return join(this.dir, `${safeName(kind)}--${safeName(this.ns)}.json`);
  }

  write(claim: BudgetClaim): void {
    try {
      mkdirSync(this.dir, { recursive: true });
      const file = this.file(claim.kind);
      const tmp = `${file}.${process.pid}.tmp`;
      // the directory may be shared with other containers: never write through a link someone left at the temp path
      // (unlink removes the link itself; `wx` refuses any path that exists, a dangling link included)
      try { unlinkSync(tmp); } catch { /* none */ }
      writeFileSync(tmp, JSON.stringify({ ...claim, ns: this.ns }), { flag: 'wx', mode: 0o644 });
      renameSync(tmp, file);
    } catch { /* a ledger that cannot be written leaves this kind on its own budget view */ }
  }

  remove(kind: string): void {
    try { unlinkSync(this.file(kind)); } catch { /* gone */ }
  }

  read(now = Date.now()): BudgetClaim[] {
    let files: string[];
    try { files = readdirSync(this.dir).filter((f) => f.endsWith('.json')); } catch { return []; }
    const out: BudgetClaim[] = [];
    for (const f of files) {
      const text = tryRead(join(this.dir, f));
      if (!text) continue;
      try {
        const c = JSON.parse(text) as BudgetClaim;
        if (typeof c.kind !== 'string' || typeof c.updatedAt !== 'number' || now - c.updatedAt > this.staleMs) continue;
        // a PID is checked only in the namespace it belongs to; a foreign claim lives as long as it is refreshed
        const sameNamespace = c.ns === undefined || c.ns === this.ns;
        if (sameNamespace && !this.alive(c.pid)) continue;
        out.push(c);
      } catch { /* torn or foreign */ }
    }
    return out;
  }
}

const safeName = (kind: string): string => kind.replace(/[^a-zA-Z0-9_-]/g, '_');

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}
