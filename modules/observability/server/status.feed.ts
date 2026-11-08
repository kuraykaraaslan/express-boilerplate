import { esc, statusLabel } from './status.render'
import type { PublicIncident, PublicPage } from './status.public.service'

/**
 * RSS 2.0 and Atom 1.0 feeds of a page (observability phase 15.5), per page and per component. Built only from the page's
 * allowlisted incidents: title, severity, public message and the public updates. A feed has no subscriber, token or secret in it and
 * needs none, which is what lets it be public and cacheable.
 */

export type FeedFormat = 'atom' | 'rss'

export interface FeedArgs {
  /** Absolute URL of the status page the feed describes. */
  pageUrl: string
  /** Absolute URL of this feed. */
  selfUrl: string
  /** Restrict to one component (must be a component of the page). */
  componentId?: string | null
}

const MAX_ENTRIES = 50

function latestActivity(i: PublicIncident): Date {
  const times = [new Date(i.startedAt), ...(i.resolvedAt ? [new Date(i.resolvedAt)] : []), ...i.updates.map((u) => new Date(u.createdAt))]
  return new Date(Math.max(...times.map((t) => t.getTime())))
}

/** The entries a feed carries, newest first; component-scoped when asked (an incident naming no component concerns all of them). */
export function feedIncidents(page: PublicPage, componentId?: string | null): PublicIncident[] {
  const all = [...page.activeIncidents, ...page.recentIncidents]
  const scoped = componentId
    ? all.filter((i) => i.affectedComponentIds.length === 0 || i.affectedComponentIds.includes(componentId))
    : all
  return scoped.sort((a, b) => latestActivity(b).getTime() - latestActivity(a).getTime()).slice(0, MAX_ENTRIES)
}

function entryBody(i: PublicIncident, page: PublicPage): string {
  const names = new Map(page.components.map((c) => [c.componentId, c.name]))
  const affected = i.affectedComponentIds.map((id) => names.get(id)).filter(Boolean)
  const parts: string[] = []
  parts.push(`Status: ${i.resolvedAt ? 'Resolved' : 'Open'} (${i.severity})`)
  if (affected.length) parts.push(`Affected: ${affected.join(', ')}`)
  if (i.publicMessage) parts.push(i.publicMessage)
  for (const u of i.updates) parts.push(`${new Date(u.createdAt).toISOString()} ${u.status}: ${u.publicMessage}`)
  return parts.join('\n')
}

function title(page: PublicPage, componentId?: string | null): string {
  const c = componentId ? page.components.find((x) => x.componentId === componentId) : null
  return c ? `${page.page.name} - ${c.name}` : page.page.name
}

export function buildAtomFeed(page: PublicPage, args: FeedArgs): string {
  const items = feedIncidents(page, args.componentId)
  const updated = items.length ? latestActivity(items[0]) : new Date(page.generatedAt)
  const out = [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${esc(page.language.served)}">`,
    `<id>${esc(args.selfUrl)}</id>`,
    `<title>${esc(title(page, args.componentId))}</title>`,
    `<subtitle>${esc(statusLabel(page.overall))}</subtitle>`,
    `<updated>${updated.toISOString()}</updated>`,
    `<link rel="alternate" href="${esc(args.pageUrl)}"/>`,
    `<link rel="self" href="${esc(args.selfUrl)}"/>`,
  ]
  for (const i of items) {
    out.push(
      '<entry>',
      `<id>${esc(`${args.pageUrl}#incident-${i.incidentId}`)}</id>`,
      `<title>${esc(i.title)}</title>`,
      `<updated>${latestActivity(i).toISOString()}</updated>`,
      `<published>${new Date(i.startedAt).toISOString()}</published>`,
      `<link rel="alternate" href="${esc(`${args.pageUrl}#incident-${i.incidentId}`)}"/>`,
      `<category term="${esc(i.severity)}"/>`,
      `<content type="text">${esc(entryBody(i, page))}</content>`,
      '</entry>',
    )
  }
  out.push('</feed>')
  return out.join('\n')
}

export function buildRssFeed(page: PublicPage, args: FeedArgs): string {
  const items = feedIncidents(page, args.componentId)
  const built = items.length ? latestActivity(items[0]) : new Date(page.generatedAt)
  const out = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>',
    `<title>${esc(title(page, args.componentId))}</title>`,
    `<link>${esc(args.pageUrl)}</link>`,
    `<description>${esc(statusLabel(page.overall))}</description>`,
    `<language>${esc(page.language.served)}</language>`,
    `<lastBuildDate>${built.toUTCString()}</lastBuildDate>`,
    `<atom:link href="${esc(args.selfUrl)}" rel="self" type="application/rss+xml"/>`,
  ]
  for (const i of items) {
    out.push(
      '<item>',
      `<guid isPermaLink="false">${esc(`${args.pageUrl}#incident-${i.incidentId}`)}</guid>`,
      `<title>${esc(i.title)}</title>`,
      `<link>${esc(`${args.pageUrl}#incident-${i.incidentId}`)}</link>`,
      `<pubDate>${new Date(i.startedAt).toUTCString()}</pubDate>`,
      `<category>${esc(i.severity)}</category>`,
      `<description>${esc(entryBody(i, page))}</description>`,
      '</item>',
    )
  }
  out.push('</channel></rss>')
  return out.join('\n')
}
