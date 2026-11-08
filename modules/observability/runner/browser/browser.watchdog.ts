import { readdirSync, readFileSync } from 'node:fs'

/**
 * Resource limits for ONE browser run (observability phase 09, D-OBS-8). A page can be written to eat memory, spin a CPU, or fork renderers; the container's own cgroup limits are
 * the outer wall (see the compose file), and this is the inner one that ends THE CHECK, not the runner: it measures the browser's whole process tree from /proc a few times a second
 * and kills it when the run is over its memory, CPU-time or process budget, or past its wall-clock budget.
 *
 * The tree is found by a marker argument given to the browser at launch (`--probe-run-id=<id>`): the one process with it is the root, and everything whose parent chain
 * leads to it belongs to the run. /proc is Linux-only; elsewhere `scan()` answers null and only the wall-clock budget applies (said in the README, not hidden).
 */

export interface TreeUsage { pids: number[]; rssBytes: number; cpuSeconds: number }
export interface RunLimits { maxRssBytes: number; maxCpuSeconds: number; maxProcesses: number }

export const DEFAULT_LIMITS: RunLimits = { maxRssBytes: 1024 * 1024 * 1024, maxCpuSeconds: 90, maxProcesses: 48 }

interface ProcRow { pid: number; ppid: number; rss: number; cpuTicks: number; cmdline: string }

const PAGE_SIZE = 4096
const CLK_TCK = 100

/** Pure: one /proc/<pid>/stat line to its parent pid and CPU ticks (utime + stime). The command name can contain spaces and parentheses, so parse from the LAST `)`. */
export function parseStat(line: string): { ppid: number; cpuTicks: number } | null {
  const end = line.lastIndexOf(')')
  if (end < 0) return null
  const rest = line.slice(end + 2).split(' ')
  // fields after the command: state(0) ppid(1) ... utime(11) stime(12)
  const ppid = Number(rest[1]); const utime = Number(rest[11]); const stime = Number(rest[12])
  if (![ppid, utime, stime].every(Number.isFinite)) return null
  return { ppid, cpuTicks: utime + stime }
}

/** Pure: the processes whose ancestry reaches a process with `marker` in its command line, with their summed usage. */
export function treeUsage(rows: ProcRow[], marker: string): TreeUsage | null {
  const roots = rows.filter((r) => r.cmdline.includes(marker)).map((r) => r.pid)
  if (roots.length === 0) return null
  const children = new Map<number, number[]>()
  for (const r of rows) { const l = children.get(r.ppid); if (l) l.push(r.pid); else children.set(r.ppid, [r.pid]) }
  const byPid = new Map(rows.map((r) => [r.pid, r]))
  const seen = new Set<number>()
  const stack = [...roots]
  while (stack.length) { const p = stack.pop() as number; if (seen.has(p)) continue; seen.add(p); for (const c of children.get(p) ?? []) stack.push(c) }
  let rss = 0; let ticks = 0
  for (const p of seen) { const r = byPid.get(p); if (r) { rss += r.rss; ticks += r.cpuTicks } }
  return { pids: [...seen], rssBytes: rss, cpuSeconds: ticks / CLK_TCK }
}

/** Pure: which limit (if any) the usage is over. */
export function overLimit(u: TreeUsage, limits: RunLimits): string | null {
  if (u.rssBytes > limits.maxRssBytes) return `the page used more than ${Math.round(limits.maxRssBytes / 1048576)} MB of memory`
  if (u.cpuSeconds > limits.maxCpuSeconds) return `the page used more than ${limits.maxCpuSeconds} s of CPU time`
  if (u.pids.length > limits.maxProcesses) return `the page started more than ${limits.maxProcesses} processes`
  return null
}

/** Read /proc once. Null when /proc is not there (not Linux). */
export function readProc(): ProcRow[] | null {
  let names: string[]
  try { names = readdirSync('/proc').filter((n) => /^\d+$/.test(n)) } catch { return null }
  const rows: ProcRow[] = []
  for (const n of names) {
    try {
      const stat = parseStat(readFileSync(`/proc/${n}/stat`, 'utf8'))
      if (!stat) continue
      const statm = readFileSync(`/proc/${n}/statm`, 'utf8').split(' ')
      const cmdline = readFileSync(`/proc/${n}/cmdline`, 'utf8').replace(/\0/g, ' ')
      rows.push({ pid: Number(n), ppid: stat.ppid, rss: Number(statm[1]) * PAGE_SIZE, cpuTicks: stat.cpuTicks, cmdline })
    } catch { /* the process ended while we looked */ }
  }
  return rows
}

export function scan(marker: string, read: () => ProcRow[] | null = readProc): TreeUsage | null {
  const rows = read()
  return rows ? treeUsage(rows, marker) : null
}

/** SIGKILL every process of the run. Safe to call twice; a process that is already gone is not an error. */
export function killTree(marker: string, read: () => ProcRow[] | null = readProc, kill: (pid: number, sig: NodeJS.Signals) => void = (pid, sig) => process.kill(pid, sig)): number {
  const usage = scan(marker, read)
  if (!usage) return 0
  let n = 0
  for (const pid of usage.pids) { try { kill(pid, 'SIGKILL'); n += 1 } catch { /* gone */ } }
  return n
}

export interface Watchdog { stop(): void; readonly tripped: string | null }

/** Watch a run: every `everyMs`, kill the tree and say why when a limit is crossed. `onTrip` runs once. */
export function startWatchdog(marker: string, limits: RunLimits, onTrip: (reason: string) => void, everyMs = 400, read: () => ProcRow[] | null = readProc): Watchdog {
  let tripped: string | null = null
  const timer = setInterval(() => {
    if (tripped) return
    const usage = scan(marker, read)
    const reason = usage ? overLimit(usage, limits) : null
    if (reason) { tripped = reason; killTree(marker, read); onTrip(reason) }
  }, everyMs)
  timer.unref?.()
  return { stop: () => clearInterval(timer), get tripped() { return tripped } }
}
