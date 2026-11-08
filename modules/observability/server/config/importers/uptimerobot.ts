import { parseCsv } from '../../uptime.monitor.import'
import { ConfigParseError, scanHostile } from '../config.parse'
import { blank, finish, isObj, KeyAllocator, newReport, num, parseJson, secretHeader, str, type Importer } from './importer.types'

/**
 * UptimeRobot, from the `getMonitors` API response (v2 JSON), the v3 `GET /monitors` response (JSON) or a bulk-upload style CSV with a header row.
 *
 * VERIFIED (2026-10-18; evidence per item in docs/phases/09-observability/21-importer-verification.md):
 *  - v2 (legacy) official reference, https://uptimerobot.com/api/legacy/ : the field names and the numeric tables, `type` 1 HTTP(s) / 2 Keyword / 3 Ping /
 *    4 Port / 5 Heartbeat, `sub_type` 1 HTTP(80) 2 HTTPS(443) 3 FTP(21) 4 SMTP(25) 5 POP3(110) 6 IMAP(143) 99 custom, `keyword_type` 1 exists / 2 not exists,
 *    `keyword_case_type` 0 case sensitive / 1 case insensitive, `status` 0 paused / 1 not checked yet / 2 up / 8 seems down / 9 down. The same tables
 *    are in two independent clients (the louy Terraform provider, the Linuxfabrik Ansible module_utils).
 *  - `keyword_type` is the ALERT condition, not the expectation: 1 "exists" means the monitor goes DOWN while the keyword is on the page, 2 "not exists" means
 *    it goes down when the keyword is missing (the v2 text "flagged as down when the keyword exists or not exists", the v3 schema "Whether to alert when the
 *    keyword exists or when it does not exist", the help centre "alerted if the keyword is found or not found"). So only 2 maps to `expectedBodyContains`.
 *  - v3 (https://uptimerobot.com/api/v3/, OpenAPI at https://cdn.uptimerobot.com/api/openapi.yaml): the request side uses strings, `type` HTTP / KEYWORD /
 *    PING / PORT / HEARTBEAT (also DNS, API, UDP, VISUAL_COMPARISON, DEPENDENCY), `keywordType` ALERT_EXISTS / ALERT_NOT_EXISTS, `keywordCaseType`
 *    CaseSensitive / CaseInsensitive, camelCase names (`friendlyName`, `keywordValue`, `httpUsername`, `customHttpHeaders`), the status filter PAUSED / STARTED /
 *    UP / LOOKS_DOWN / DOWN, a list envelope `{ nextLink, data: [...] }`. The OpenAPI leaves the RESPONSE schemas of `type` and `status` untyped, so reading
 *    those strings back is inferred from the request enums, and numeric codes are still accepted.
 *  - The bulk-upload template (help centre, 2025-08-27) has columns Type (HTTP, Ping, Port or Keyword), URL/IP, Interval (60 to 86400), Friendly Name,
 *    Keyword Type and Value, Port, Tags (separated by semicolons).
 * NOT VERIFIED: the exact header strings and the keyword-type cell values of the bulk-upload template (only the prose above is published; the dashboard
 * template needs an account), and any CSV EXPORT of monitor settings (a third party says the dashboard exports logs only; UptimeRobot documents none).
 * The CSV reader accepts those names case-insensitively and refuses a row whose type or keyword condition it does not recognise.
 */

const TYPE_BY_CODE: Record<string, string> = { '1': 'http', '2': 'keyword', '3': 'ping', '4': 'port', '5': 'heartbeat' }
const TYPE_BY_NAME: Record<string, string> = { http: 'http', 'http(s)': 'http', https: 'http', keyword: 'keyword', ping: 'ping', port: 'port', heartbeat: 'heartbeat', cron: 'heartbeat' }
/** Monitor types of API v3 (and of the dashboard) that have no check type here. */
const KNOWN_UNMAPPED_TYPES = new Set(['dns', 'api', 'udp', 'visual_comparison', 'dependency', 'ssl', 'domain'])
/** `sub_type` of a port monitor: well-known services (v2 reference); 99 is "custom" and uses `port`. */
const SERVICE_PORT: Record<string, number> = { '1': 80, '2': 443, '3': 21, '4': 25, '5': 110, '6': 143 }

/**
 * Does the monitor ALERT while the keyword is on the page? `keyword_type` 1 / ALERT_EXISTS: yes (down when present); 2 / ALERT_NOT_EXISTS: no (down when
 * missing). Null when the value is not one of those (a CSV cell in an unpublished spelling).
 */
function alertsWhenKeywordExists(raw: unknown): boolean | null {
  const s = String(raw ?? '').trim().toLowerCase()
  if (s === '1') return true
  if (s === '2') return false
  if (!s) return null
  const negative = /\bnot\b|n't|missing|absent|notex|_not_/.test(s)
  const positive = /exist|present|found|contain/.test(s)
  if (positive) return !negative
  return null
}

/** `friendlyName` to `friendly_name`: v3 names are camelCase, v2 and the CSV are snake_case; an existing snake_case key wins. */
function snakeKeys(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row }
  for (const k of Object.keys(row)) {
    const snake = k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
    if (snake !== k && !(snake in out)) out[snake] = row[k]
  }
  return out
}

function tagList(raw: unknown): string[] {
  const parts = typeof raw === 'string' ? raw.split(';') : Array.isArray(raw) ? raw.map((t) => (isObj(t) ? t.name : t)) : []
  return parts.map((p) => str(p)).filter((p): p is string => p !== null).map((p) => p.slice(0, 40)).slice(0, 20)
}

function isPaused(status: unknown): boolean {
  const s = String(status ?? '').trim().toLowerCase()
  return s === '0' || s === 'paused'
}

function rowsOf(text: string, format: 'json' | 'csv', report: { errors: string[] }): Array<Record<string, unknown>> | null {
  if (format === 'json') {
    const parsed = parseJson(text)
    if ('error' in parsed) { report.errors.push(parsed.error); return null }
    try { scanHostile(parsed.value) } catch (e) { report.errors.push((e as ConfigParseError).message); return null }
    const v = parsed.value
    const list = Array.isArray(v) ? v : isObj(v) && Array.isArray(v.monitors) ? v.monitors : isObj(v) && Array.isArray(v.data) ? v.data : null
    if (!list) { report.errors.push('expected a getMonitors response (an object with a `monitors` list), a v3 list response (an object with `data`) or a list of monitors'); return null }
    if (!list.every(isObj)) { report.errors.push('a monitor entry is not an object'); return null }
    return (list as Array<Record<string, unknown>>).map(snakeKeys)
  }
  if (Buffer.byteLength(text, 'utf8') > 5_000_000) { report.errors.push('the input is larger than 5 MB'); return null }
  const table = parseCsv(text)
  if (table.length < 2) { report.errors.push('the CSV has no data rows'); return null }
  const alias: Record<string, string> = { 'friendly name': 'friendly_name', friendlyname: 'friendly_name', name: 'friendly_name', 'url/ip': 'url', 'url / ip': 'url', 'url or ip': 'url', 'keyword value': 'keyword_value', keyword: 'keyword_value', 'interval (seconds)': 'interval', 'monitoring interval': 'interval', 'keyword type': 'keyword_type' }
  const header = table[0].map((h) => { const k = h.trim().toLowerCase(); return alias[k] ?? k.replace(/\s+/g, '_') })
  return table.slice(1).map((r) => Object.fromEntries(header.map((k, i) => [k, (r[i] ?? '').trim()])))
}

export const uptimeRobotImporter: Importer = {
  id: 'uptimerobot',
  title: 'UptimeRobot monitors (getMonitors JSON, or CSV)',
  accepts: ['json', 'csv'],
  cannotMap: [
    'alert contacts and their thresholds (the alert pipeline has routes and targets instead)',
    'public status pages, maintenance windows, response-time and log history',
    'HTTP authentication passwords and custom headers (never copied: environment references are written for a username that was present)',
    'keyword monitors that alert when the keyword EXISTS (the check goes down while the text is on the page): there is no "must not contain" assertion',
    'DNS, API, UDP, visual-comparison and dependency monitors of API v3 (no equivalent check type, or a response shape that is not documented)',
    'the exact header strings and keyword-type cell values of the bulk-upload CSV template are not published: a spelling that is not recognised is refused, never guessed',
  ],
  run(text, opts) {
    const report = newReport('uptimerobot', 'v2 getMonitors fields and numeric codes verified against the official reference and two clients; v3 names from its OpenAPI; CSV header strings and keyword-type cells unverified')
    const format = opts?.format === 'csv' || (!opts?.format && !/^\s*[[{]/.test(text)) ? 'csv' : 'json'
    const rows = rowsOf(text, format, report)
    if (!rows) return finish(report, blank())
    if (rows.length > 500) { report.errors.push('more than 500 monitors: split the export'); return finish(report, blank()) }
    const keys = new KeyAllocator()
    const draft = blank()
    for (const m of rows) {
      const name = str(m.friendly_name)
      const rawType = String(m.type ?? '').trim()
      const type = TYPE_BY_CODE[rawType] ?? TYPE_BY_NAME[rawType.toLowerCase()]
      const from = `monitor "${name ?? '(unnamed)'}" (type ${rawType || '?'})`
      if (!name) { report.unmapped.push({ item: from, reason: 'no friendly_name' }); continue }
      if (!type) { report.unmapped.push({ item: from, reason: KNOWN_UNMAPPED_TYPES.has(rawType.toLowerCase()) ? `the monitor type "${rawType}" has no equivalent check type here` : `the monitor type "${rawType}" is not recognised` }); continue }
      const key = keys.next(name, 'monitor')
      const notes: string[] = []
      const out: Record<string, unknown> = { key, name }
      const interval = num(m.interval)
      if (interval !== null && interval > 0) out.intervalSeconds = Math.min(86400, Math.round(interval))
      if (m.status !== undefined && isPaused(m.status)) { out.isActive = false; notes.push('it was paused') }
      const tags = tagList(m.tags)
      if (tags.length) out.tags = tags
      const url = str(m.url)
      switch (type) {
        case 'http': case 'keyword': {
          if (!url || !/^https?:\/\//i.test(url)) { report.unmapped.push({ item: from, reason: 'no http(s) url' }); continue }
          Object.assign(out, { type: 'HTTP', target: url })
          if (type === 'keyword') {
            const kw = str(m.keyword_value)
            if (!kw) { report.unmapped.push({ item: from, reason: 'a keyword monitor without a keyword' }); continue }
            // keyword_type is the ALERT condition: 1 / ALERT_EXISTS goes down while the keyword is present, 2 / ALERT_NOT_EXISTS goes down when it is missing.
            const onExists = alertsWhenKeywordExists(m.keyword_type)
            if (onExists === null) { report.unmapped.push({ item: from, reason: `the keyword condition "${String(m.keyword_type ?? '')}" is not one of 1 / 2 / ALERT_EXISTS / ALERT_NOT_EXISTS: not guessed` }); continue }
            if (onExists) { report.unmapped.push({ item: from, reason: '"alert when the keyword exists" goes down while the text is on the page; there is no "must not contain" assertion (expectedBodyContains asserts presence)' }); continue }
            out.expectedBodyContains = kw.slice(0, 500)
            if (String(m.keyword_case_type ?? '') === '1' || /insensitive/i.test(String(m.keyword_case_type ?? ''))) notes.push('keyword matching here is case sensitive')
          }
          const headerNames = isObj(m.custom_http_headers) ? Object.keys(m.custom_http_headers).slice(0, 20) : []
          const hdrs: Record<string, { fromEnv: string }> = {}
          for (const n of headerNames) hdrs[n] = secretHeader(report, key, n)
          if (str(m.http_username)) { hdrs.Authorization = secretHeader(report, key, 'Authorization'); notes.push('the HTTP auth password is not copied: set the Authorization environment variable to "Basic <base64 of user:password>"') }
          if (headerNames.length) notes.push('header values are not copied: provide the environment variables listed in the report')
          if (Object.keys(hdrs).length) out.headers = hdrs
          break
        }
        case 'ping': {
          const host = str(m.url)
          if (!host) { report.unmapped.push({ item: from, reason: 'no host' }); continue }
          Object.assign(out, { type: 'PING', target: host }); notes.push('a PING monitor is a TCP reachability check (443, then 80), not ICMP'); break
        }
        case 'port': {
          const host = str(m.url)
          const sub = String(m.sub_type ?? '').trim()
          const given = num(m.port)
          const port = given ?? SERVICE_PORT[sub] ?? null
          if (!host || port === null) { report.unmapped.push({ item: from, reason: 'no host, or a port that cannot be determined' }); continue }
          // `port` wins: an Ansible client reports that getMonitors answers sub_type 1 for every port monitor, so the preset is only a fallback.
          if (given === null) notes.push(`the port ${port} comes from the sub_type preset, which getMonitors may report as 1 whatever the real port is: check it`)
          Object.assign(out, { type: 'TCP', target: `${host}:${port}` }); break
        }
        case 'heartbeat':
          Object.assign(out, { type: 'HEARTBEAT' }); notes.push('a new heartbeat URL is issued when the file is applied; the job must be pointed at it'); break
      }
      draft.monitors.push(out as never)
      report.mapped.push({ kind: 'monitor', key, from, notes })
    }
    return finish(report, draft)
  },
}
