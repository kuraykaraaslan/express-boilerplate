import { createHash } from 'node:crypto'
import { esc, safeHexColor, safeHttpsUrl, STATUS_HEX } from './status.render'
import type { PublicIncident, PublicPage } from './status.public.service'
import { chromeFor, type SnapshotChrome } from './status.snapshot.chrome'
import { chartGeometry } from './status.chart'

/**
 * Static HTML renderers (observability phase 15.8 and 15.9): the embeddable widget and the full snapshot page. Both are pure functions
 * of a `PublicPage` from the one serializer and nothing else.
 *
 * They carry NO tenant-authored script, and the snapshot's single platform script (the staleness banner) is allowed by a content
 * hash in the page's own CSP, so nothing else can run there. Tenant strings only ever reach the page escaped; the only tenant URL
 * (the logo) must be https and is loaded under `img-src https:`.
 *
 * Every word that is not the tenant's data (banner, status names, headings, the "Last updated" line, the staleness notice) comes from the
 * dictionary in `status.snapshot.chrome.ts`, looked up per page language: pure, English authoritative (decision D-OBS-13).
 */

const CSS = `
:root{color-scheme:light dark;--fg:#111827;--muted:#6b7280;--line:#e5e7eb;--bg:#ffffff;--card:#ffffff}
@media (prefers-color-scheme:dark){:root{--fg:#f3f4f6;--muted:#9ca3af;--line:#374151;--bg:#111827;--card:#1f2937}}
html[data-theme=light]{--fg:#111827;--muted:#6b7280;--line:#e5e7eb;--bg:#ffffff;--card:#ffffff}
html[data-theme=dark]{--fg:#f3f4f6;--muted:#9ca3af;--line:#374151;--bg:#111827;--card:#1f2937}
*{box-sizing:border-box}body{margin:0;font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--fg);background:var(--bg)}
main{max-width:760px;margin:0 auto;padding:24px 16px}h1,h2{margin:0}h2{font-size:14px;margin:24px 0 8px}
.hd{display:flex;align-items:center;gap:12px;border-bottom:2px solid var(--line);padding-bottom:12px;margin-bottom:16px}
.hd img{height:32px;width:auto}.hd b{font-size:16px}
.banner{border-radius:12px;padding:16px 20px;color:#fff;font-size:18px;font-weight:600}.banner small{display:block;font-size:12px;font-weight:400;opacity:.85}
.row{display:flex;align-items:center;gap:12px;border:1px solid var(--line);background:var(--card);border-radius:8px;padding:10px 14px;margin-top:8px}
.dot{width:10px;height:10px;border-radius:50%;flex:none}.grow{flex:1;min-width:0}.name{font-weight:500}.desc,.muted{color:var(--muted);font-size:12px}
.grp{margin-top:16px}.grp>summary{cursor:pointer;font-weight:600}
.bars{display:flex;gap:1px;margin-top:6px}.bars i{flex:1;height:22px;border-radius:2px;min-width:2px}
.inc{border:1px solid var(--line);background:var(--card);border-radius:8px;padding:12px 14px;margin-top:8px}
.inc ol{margin:6px 0 0;padding-left:16px;border-left:2px solid var(--line);list-style:none}
.tag{font-size:11px;border:1px solid var(--line);border-radius:4px;padding:0 6px;color:var(--muted)}
.warn{background:#fef3c7;color:#78350f;border:1px solid #f59e0b;border-radius:8px;padding:10px 14px;margin:0 0 12px}
.regs{display:flex;flex-wrap:wrap;gap:4px 14px;flex-basis:100%;margin-top:2px}.reg{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)}.reg .dot{width:8px;height:8px}
.rt{flex-basis:100%;margin-top:6px}.rt svg{display:block;width:100%;height:48px}.rt .l{fill:none;stroke-width:1.5}.rt .a{stroke:var(--fg)}.rt .p{stroke:var(--muted);stroke-dasharray:3 2}
.s-NO_DATA{background:${STATUS_HEX.NO_DATA}}.s-OPERATIONAL{background:${STATUS_HEX.OPERATIONAL}}.s-DEGRADED{background:${STATUS_HEX.DEGRADED}}
.s-PARTIAL_OUTAGE{background:${STATUS_HEX.PARTIAL_OUTAGE}}.s-MAJOR_OUTAGE{background:${STATUS_HEX.MAJOR_OUTAGE}}.s-MAINTENANCE{background:${STATUS_HEX.MAINTENANCE}}
a{color:inherit}
`.replace(/\n/g, '')

function layout(page: PublicPage, args: { title: string; csp: string; extraHead?: string; body: string }): string {
  const theme = page.page.theme === 'AUTO' ? '' : ` data-theme="${page.page.theme.toLowerCase()}"`
  return `<!doctype html><html lang="${esc(page.language.served)}" dir="${page.language.rtl ? 'rtl' : 'ltr'}"${theme}><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer">`
    + `<meta http-equiv="Content-Security-Policy" content="${esc(args.csp)}">`
    + `<title>${esc(args.title)}</title><style>${CSS}</style>${args.extraHead ?? ''}</head><body>${args.body}</body></html>`
}

function header(page: PublicPage): string {
  const b = page.branding
  if (!b) return ''
  const logo = safeHttpsUrl(b.logoLight)
  const color = safeHexColor(b.primaryColor)
  return `<div class="hd"${color ? ` style="border-color:${color}"` : ''}>`
    + (logo ? `<img src="${esc(logo)}" alt="">` : '')
    + (b.name ? `<b${color ? ` style="color:${color}"` : ''}>${esc(b.name)}</b>` : '')
    + '</div>'
}

function bannerHtml(page: PublicPage, updatedLabel: string, chrome: SnapshotChrome): string {
  return `<div class="banner s-${esc(page.overall)}" role="status">${esc(chrome.banner(page.overall))}<small>${esc(updatedLabel)}</small></div>`
}

type PageComponent = PublicPage['components'][number]

function bars(c: PageComponent, chrome: SnapshotChrome): string {
  if (!c.history) return ''
  return `<div class="bars" aria-hidden="true">${c.history.map((d) =>
    `<i class="s-${esc(d.status)}" title="${esc(`${d.day}: ${d.status === 'NO_DATA' ? chrome.t('observability.status.noData') : chrome.status(d.status)}${d.uptime === null ? '' : ` ${d.uptime}%`}${d.incidentIds.length ? ` - ${chrome.t('observability.status.incidentMarker')}` : ''}`)}"></i>`).join('')}</div>`
}

/**
 * The regions of a component (phase 10.5): one chip per exposed probe location with its public label, status and 90-day uptime. The serializer
 * decided which locations exist here; this only draws what it was given (an opaque id is never printed, a key does not exist in the data).
 */
function regionsHtml(c: PageComponent, chrome: SnapshotChrome): string {
  if (!c.regions || c.regions.length === 0) return ''
  return `<div class="regs" aria-label="${esc(chrome.t('observability.status.regions'))}">${c.regions.map((r) =>
    `<span class="reg"><span class="dot s-${esc(r.status)}"></span>${esc(r.label)}: ${esc(chrome.status(r.status))}`
    + `${r.uptime && r.uptime['90d'] !== null ? ` (${esc(chrome.t('observability.status.regionUptime', { pct: r.uptime['90d'] }))})` : ''}</span>`).join('')}</div>`
}

/**
 * The response-time chart (phase 15.6): plain inline SVG polylines of the daily average and the approximate p95, from the serializer's daily
 * aggregates only. // kui-integration: day-bar chart (replaces this markup when the kui component lands).
 */
function responseTimeHtml(c: PageComponent, chrome: SnapshotChrome): string {
  const rt = c.responseTime
  if (!rt || (rt.avgMs === null && rt.p95Ms === null)) return ''
  const g = chartGeometry(rt)
  const summary = chrome.t('observability.status.responseTimeSummary', {
    avg: rt.avgMs === null ? chrome.t('observability.status.noData') : `${rt.avgMs} ms`,
    p95: rt.p95Ms === null ? chrome.t('observability.status.noData') : `${rt.p95Ms} ms`,
  })
  const label = `${chrome.t('observability.status.responseTime')}: ${summary}`
  return `<div class="rt"><svg viewBox="0 0 ${g.width} ${g.height}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title>`
    + g.p95.map((pts) => `<polyline class="l p" points="${esc(pts)}"/>`).join('')
    + g.avg.map((pts) => `<polyline class="l a" points="${esc(pts)}"/>`).join('')
    + `</svg><div class="desc">${esc(chrome.t('observability.status.responseTimeNote'))}</div></div>`
}

function componentRow(c: PageComponent, withBars: boolean, chrome: SnapshotChrome): string {
  return `<div class="row" style="flex-wrap:wrap"><span class="dot s-${esc(c.status)}"></span>`
    + `<div class="grow"><div class="name">${esc(c.name)}</div>${c.description ? `<div class="desc">${esc(c.description)}</div>` : ''}</div>`
    + `<span class="muted">${esc(chrome.status(c.status))}</span>`
    + (c.showUptime && c.uptime ? `<span class="muted">${esc(c.uptime['90d'])}%</span>` : '')
    + regionsHtml(c, chrome)
    + (withBars ? `<div style="flex-basis:100%">${bars(c, chrome)}</div>` : '')
    + (withBars ? responseTimeHtml(c, chrome) : '')
    + '</div>'
}

function incidentHtml(i: PublicIncident): string {
  return `<div class="inc" id="incident-${esc(i.incidentId)}"><b>${esc(i.title)}</b> <span class="tag">${esc(i.severity)}</span>`
    + ` <span class="muted">${esc(new Date(i.startedAt).toISOString().replace('T', ' ').slice(0, 16))} UTC</span>`
    + (i.publicMessage ? `<div>${esc(i.publicMessage)}</div>` : '')
    + (i.updates.length ? `<ol>${i.updates.map((u) => `<li><b>${esc(u.status)}</b> - ${esc(u.publicMessage)} <span class="muted">${esc(new Date(u.createdAt).toISOString().replace('T', ' ').slice(0, 16))} UTC</span></li>`).join('')}</ol>` : '')
    + '</div>'
}

function componentsHtml(page: PublicPage, withBars: boolean, chrome: SnapshotChrome): string {
  const ungrouped = page.components.filter((c) => !c.groupId)
  const parts: string[] = []
  for (const g of page.groups) {
    const members = page.components.filter((c) => c.groupId === g.groupId)
    parts.push(`<details class="grp"${g.collapsed ? '' : ' open'}><summary>${esc(g.name)}</summary>${g.description ? `<div class="desc">${esc(g.description)}</div>` : ''}${members.map((c) => componentRow(c, withBars, chrome)).join('')}</details>`)
  }
  if (ungrouped.length) parts.push(ungrouped.map((c) => componentRow(c, withBars, chrome)).join(''))
  return parts.join('')
}

/** An iframe-friendly widget: banner and component list only, refreshed by the browser, no script at all. */
export function buildWidgetHtml(page: PublicPage, args: { statusUrl: string }): string {
  const csp = [
    "default-src 'none'", "style-src 'unsafe-inline'", 'img-src https:', "base-uri 'none'", "form-action 'none'",
  ].join('; ')
  const chrome = chromeFor(page.language.served)
  // The widget is a glance: banner, components and their regions; no uptime figure, no bars, no chart.
  const rows = page.components.map((c) => componentRow({ ...c, history: null, uptime: null, showUptime: false, responseTime: null }, false, chrome)).join('')
  const updated = chrome.t('observability.status.snapshot.updatedShort', { at: new Date(page.generatedAt).toISOString().slice(11, 16) })
  const body = `<main>${bannerHtml(page, updated, chrome)}${rows}`
    + `<p class="muted"><a href="${esc(args.statusUrl)}" target="_blank" rel="noopener">${esc(page.page.name)}</a></p></main>`
  // frame-ancestors cannot be set from a <meta>: the widget route sends it as a header.
  return layout(page, { title: chrome.t('observability.status.snapshot.title', { name: page.page.name }), csp, extraHead: '<meta http-equiv="refresh" content="60">', body })
}

export interface SnapshotMeta {
  generatedAt: string
  /** The page is considered stale (and says so) after this many seconds without a refresh. */
  staleAfterSeconds: number
  /** Where each offered language's snapshot lives, relative to this one. */
  languageLinks: Array<{ language: string; href: string }>
}

const STALE_SCRIPT = "(function(){var e=document.getElementById('stale');if(!e)return;var t=Date.parse(e.getAttribute('data-stale-after'));if(t&&Date.now()>t){e.hidden=false}})();"

export function staleScriptHash(): string {
  return `sha256-${createHash('sha256').update(STALE_SCRIPT).digest('base64')}`
}

/**
 * The full static page. It must be readable with the application and the database gone, so it has no fetch, no framework and no
 * external stylesheet. It always prints when it was generated; a platform script (hash-pinned in the CSP) additionally reveals a
 * banner once the page is older than its bound.
 */
export function buildSnapshotHtml(page: PublicPage, meta: SnapshotMeta): string {
  const generated = new Date(meta.generatedAt)
  const staleAfter = new Date(generated.getTime() + meta.staleAfterSeconds * 1000)
  const csp = [
    "default-src 'none'", "style-src 'unsafe-inline'", 'img-src https:', `script-src '${staleScriptHash()}'`, "base-uri 'none'", "form-action 'none'",
  ].join('; ')
  const chrome = chromeFor(page.language.served)
  const stamp = generated.toISOString().replace('T', ' ').slice(0, 16)
  const updated = chrome.t('observability.status.snapshot.lastUpdated', { at: stamp })
  const langs = meta.languageLinks.length > 1
    ? `<p class="muted">${meta.languageLinks.map((l) => `<a href="${esc(l.href)}">${esc(l.language)}</a>`).join(' | ')}</p>`
    : ''
  const fallback = page.language.fallback
    ? `<p class="muted">${esc(chrome.t('observability.status.fallback', { language: page.language.primary }))}</p>`
    : ''
  const maintenance = [...page.maintenance.active, ...page.maintenance.upcoming]
  const body = `<main>${header(page)}`
    + `<div id="stale" class="warn" hidden data-stale-after="${esc(staleAfter.toISOString())}">`
    + `${esc(chrome.t('observability.status.snapshot.staleNotice', { at: stamp }))}</div>`
    + bannerHtml(page, updated, chrome) + langs + fallback
    + `<section>${componentsHtml(page, true, chrome) || `<p class="muted">${esc(chrome.t('observability.status.noComponents'))}</p>`}</section>`
    + (maintenance.length
      ? `<h2>${esc(chrome.t('observability.status.maintenanceTitle'))}</h2>${maintenance.map((m) => `<div class="inc"><b>${esc(m.title)}</b> <span class="tag">${esc(m.active ? chrome.t('observability.status.maintenanceActive') : chrome.t('observability.status.maintenanceUpcoming'))}</span>${m.message ? `<div>${esc(m.message)}</div>` : ''}<div class="muted">${esc(new Date(m.scheduledStart).toISOString().replace('T', ' ').slice(0, 16))} UTC${m.scheduledEnd ? ` - ${esc(new Date(m.scheduledEnd).toISOString().replace('T', ' ').slice(0, 16))} UTC` : ''}</div></div>`).join('')}`
      : '')
    + (page.activeIncidents.length ? `<h2>${esc(chrome.t('observability.status.activeIncidents'))}</h2>${page.activeIncidents.map(incidentHtml).join('')}` : '')
    + (page.recentIncidents.length ? `<h2>${esc(chrome.t('observability.status.pastIncidents'))}</h2>${page.recentIncidents.map(incidentHtml).join('')}` : '')
    + `<noscript><p class="muted">${esc(chrome.t('observability.status.snapshot.noscript', { updated }))}</p></noscript>`
    + `<script>${STALE_SCRIPT}</script></main>`
  return layout(page, { title: chrome.t('observability.status.snapshot.title', { name: page.page.name }), csp, body })
}

