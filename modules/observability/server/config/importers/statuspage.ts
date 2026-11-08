import { ConfigParseError, scanHostile } from '../config.parse'
import { blank, finish, isObj, KeyAllocator, newReport, parseJson, str, type Importer } from './importer.types'

/**
 * Atlassian Statuspage components, from `GET /pages/{page_id}/components` (management API) or the public `/api/v2/components.json`.
 *
 * VERIFIED (2026-10-18):
 *  - Public feeds, https://www.githubstatus.com/api/v2/components.json (no groups), https://discordstatus.com/api/v2/components.json (3 groups, recorded
 *    verbatim in the group fixture), and cross-checked on www.cloudflarestatus.com, status.digitalocean.com and status.twilio.com (all with groups): top level
 *    `page` and `components`; a component has id, name, status, created_at, updated_at, position, description, showcase, start_date, group_id, page_id, group
 *    (boolean) and only_show_if_degraded.
 *  - A GROUP is a component with `group: true`, `group_id: null` and a `components` list of the member ids; every member carries `group_id` set to the group's
 *    id (1,762 links checked in both directions on the Discord, Cloudflare, DigitalOcean and Twilio feeds, 0 mismatches). `position` is per level: members count from 1 inside their group, so a global sort by
 *    position interleaves them; the converter orders top-level entries by position and lists each group's members after it.
 *  - The management API reference (https://developer.statuspage.io/): `GET /pages/{page_id}/components` answers a bare array of component objects (the same
 *    fields), paginated (default and maximum 100 per page since 2023-02-28, `page` / `per_page`), and groups also exist as `GET /pages/{page_id}/component-groups`
 *    objects `{ id, page_id, name, description, components: [ids], position, created_at, updated_at }`. A group cannot be empty.
 *  - `showcase: false` does NOT mean hidden: every one of the 482 Cloudflare, 256 DigitalOcean and 20 of 33 Discord components has it and is listed on the public
 *    page, and the reference gives the field no description. It is therefore not read as "private" (an earlier version did); everything is imported public.
 * NOT VERIFIED: what `showcase` means (the reference does not say); whether the management API's component list also carries the `components` id list on a
 * group (its sample omits it, the public feeds have it, so membership is read from `group_id` as well); the shape of a `component-groups` response is read
 * from the reference only, no live management API was called (it needs a page API key).
 *
 * Only the COMPONENT STRUCTURE is imported. Subscribers are never copied: a person who subscribed to the old page has to confirm again through
 * this platform's double opt-in, which is the point of the consent record. Incidents, maintenances and metrics are not imported either.
 */
export const statuspageImporter: Importer = {
  id: 'statuspage',
  title: 'Atlassian Statuspage components (JSON)',
  accepts: ['json'],
  cannotMap: [
    'subscribers (never copied: they must re-confirm through double opt-in)',
    'incidents, scheduled maintenances, metrics and the page look',
    'the live status of a component (a component here derives its status from its monitors)',
    'component groups as a level (groups become a prefix of the component name: the status page here is one list)',
    'automation emails and start dates',
  ],
  run(text) {
    const report = newReport('statuspage', 'verified against live public feeds (with groups) and the management API reference; the meaning of showcase is undocumented')
    const parsed = parseJson(text)
    if ('error' in parsed) { report.errors.push(parsed.error); return finish(report, blank()) }
    try { scanHostile(parsed.value) } catch (e) { report.errors.push((e as ConfigParseError).message); return finish(report, blank()) }
    const list = Array.isArray(parsed.value) ? parsed.value : isObj(parsed.value) && Array.isArray(parsed.value.components) ? parsed.value.components : null
    if (!list) { report.errors.push('expected a components list (an object with `components`, or a list)'); return finish(report, blank()) }
    if (!list.every(isObj)) { report.errors.push('a component entry is not an object'); return finish(report, blank()) }
    const comps = list as Array<Record<string, unknown>>
    if (comps.length > 200) { report.errors.push('more than 200 components'); return finish(report, blank()) }

    const groups = new Map<string, string>()
    for (const c of comps) if (c.group === true && str(c.id) && str(c.name)) groups.set(str(c.id) as string, str(c.name) as string)
    const memberGroup = new Map<string, string>()
    for (const c of comps) if (c.group === true && Array.isArray(c.components)) for (const id of c.components) if (typeof id === 'string') memberGroup.set(id, str(c.id) as string)
    // The group a component sits in: its `group_id`, else the group that lists it; a group that is not in the input counts as no group.
    const parentOf = (c: Record<string, unknown>): string | null => {
      if (c.group === true) return null
      const gid = str(c.group_id) ?? memberGroup.get(str(c.id) ?? '') ?? null
      return gid && groups.has(gid) ? gid : null
    }
    const byPosition = (x: Record<string, unknown>, y: Record<string, unknown>) => (Number(x.position) || 0) - (Number(y.position) || 0)
    const members = new Map<string, Array<Record<string, unknown>>>()
    for (const c of comps) { const g = parentOf(c); if (g) members.set(g, [...(members.get(g) ?? []), c]) }
    // `position` counts per level (members restart at 1 inside their group), so top-level entries are ordered by it and each group's members follow their group.
    const ordered: Array<Record<string, unknown>> = []
    for (const t of comps.filter((c) => parentOf(c) === null).sort(byPosition)) {
      ordered.push(t)
      if (t.group === true) ordered.push(...(members.get(str(t.id) ?? '') ?? []).sort(byPosition))
    }
    if (comps.length === 100) report.warnings.push('exactly 100 components: the management API returns at most 100 per page, so the list may be cut off; fetch the next pages (page=2, ...) and merge them')

    const keys = new KeyAllocator()
    const draft = blank()
    let order = 0
    let showcaseFalse = 0
    for (const c of ordered) {
      const name = str(c.name)
      if (c.group === true) { report.mapped.push({ kind: 'group', key: '-', from: `group "${name ?? ''}"`, notes: ['its name prefixes its components'] }); continue }
      if (!name) { report.unmapped.push({ item: `component ${str(c.id) ?? '?'}`, reason: 'no name' }); continue }
      const groupId = parentOf(c)
      const group = groupId ? groups.get(groupId) : undefined
      const fullName = (group ? `${group} / ${name}` : name).slice(0, 200)
      const key = keys.next(fullName, 'component')
      const notes: string[] = []
      if (c.showcase === false) showcaseFalse += 1
      if (c.only_show_if_degraded === true) notes.push('"only show if degraded" is not supported: the component is always listed')
      const status = str(c.status)
      if (status && status !== 'operational') notes.push(`its source status "${status}" is not imported: status derives from monitors`)
      draft.components.push({ key, name: fullName, ...(str(c.description) ? { description: (str(c.description) as string).slice(0, 500) } : {}), order, isPublic: true, monitors: [] } as never)
      order += 1
      report.mapped.push({ kind: 'component', key, from: `component "${fullName}"`, notes })
    }
    if (showcaseFalse > 0) report.warnings.push(`${showcaseFalse} component(s) have showcase false: the field is undocumented and public feeds list such components, so they are imported as public; mark one private in the file if it was hidden`)
    report.warnings.push('the components have no monitors yet: link them to monitors in the file (components[].monitors) before relying on the page')
    report.unmapped.push({ item: 'subscribers', reason: 'never copied: subscribers must re-confirm through double opt-in' })
    return finish(report, draft)
  },
}
