/**
 * Which devices of a profile the bulk Scene action looks at (docs/phases/07-dashboard/42, 42.3.2, D42-7): the next `maxUnbound` devices that have
 * NO binding yet, found by paging the profile's devices (by name, `pageSize` at a time) and leaving the bound ones out, so a profile of 800
 * devices is finished by two calls, not stuck on its first 500 by name. Pure over two seams (a page of devices, and which ids are bound), so the
 * route and the tests share one walk.
 *
 * The walk stops when it has `maxUnbound` unbound devices, when the profile is exhausted (an empty or short page), when a page brings no id it
 * has not seen (an entity type that ignores `offset` answers its first page again: that is the end of what can be read, never a loop), or after
 * `maxPages` pages (a hard cap on the reads of one call).
 */
export interface BulkScan {
  /** The unbound devices found, by name, at most `maxUnbound`, lower-cased. */
  unbound: string[]
  /** The devices looked at (the unbound ones and the bound ones passed on the way). */
  scanned: number
  /** The profile's device count in all, as its first page said. */
  total: number
  /** There may be devices the walk did not look at: more unbound ones can follow in a next call. */
  truncated: boolean
}

export async function scanUnboundDevices(input: {
  pageSize: number
  maxUnbound: number
  maxPages: number
  page: (offset: number) => Promise<{ ids: string[]; total: number }>
  boundAmong: (ids: string[]) => Promise<Set<string>>
}): Promise<BulkScan> {
  const seen = new Set<string>()
  const unbound: string[] = []
  let scanned = 0
  let total = 0
  let exhausted = false
  for (let pageNo = 0; pageNo < input.maxPages; pageNo++) {
    const { ids, total: pageTotal } = await input.page(pageNo * input.pageSize)
    if (pageNo === 0) total = pageTotal
    const fresh = [...new Set(ids.map((id) => id.toLowerCase()))].filter((id) => !seen.has(id))
    if (fresh.length === 0) { exhausted = ids.length === 0; break }
    for (const id of fresh) seen.add(id)
    const bound = await input.boundAmong(fresh)
    let cut = false
    for (const id of fresh) {
      scanned += 1
      if (!bound.has(id)) unbound.push(id)
      if (unbound.length >= input.maxUnbound) { cut = true; break }
    }
    if (cut) break
    if (ids.length < input.pageSize) { exhausted = true; break }
  }
  return { unbound, scanned, total: Math.max(total, scanned), truncated: !exhausted && scanned < Math.max(total, scanned) }
}
