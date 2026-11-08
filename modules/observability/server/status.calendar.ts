import { esc } from './status.render'
import type { PublicPage } from './status.public.service'

/**
 * The maintenance calendar of a page as iCalendar (RFC 5545), observability phase 15.6. Built from the page's allowlisted maintenance
 * block: title, message and the scheduled times, nothing else. Lines are CRLF terminated and folded at 75 octets.
 */

function icsText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

export function icsDate(d: Date | string): string {
  return new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/** Fold a content line at 75 octets (counted in UTF-8 bytes), continuing with a single space. */
export function foldLine(line: string): string {
  const bytes = Buffer.from(line, 'utf8')
  if (bytes.length <= 75) return line
  const parts: string[] = []
  let start = 0
  let limit = 75
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length)
    // never cut inside a multi-byte character
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--
    parts.push(bytes.subarray(start, end).toString('utf8'))
    start = end
    limit = 74
  }
  return parts.join('\r\n ')
}

export function buildMaintenanceIcs(page: PublicPage, args: { host: string; pageUrl: string }): string {
  const stamp = icsDate(page.generatedAt)
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Roltek//Status page//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(`${page.page.name} maintenance`)}`]
  for (const w of [...page.maintenance.active, ...page.maintenance.upcoming]) {
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:maintenance-${esc(w.windowId)}@${esc(args.host)}`)
    lines.push(`DTSTAMP:${stamp}`)
    lines.push(`DTSTART:${icsDate(w.scheduledStart)}`)
    if (w.scheduledEnd) lines.push(`DTEND:${icsDate(w.scheduledEnd)}`)
    lines.push(`SUMMARY:${icsText(w.title)}`)
    if (w.message) lines.push(`DESCRIPTION:${icsText(w.message)}`)
    lines.push('CATEGORIES:MAINTENANCE', 'STATUS:CONFIRMED', 'TRANSP:OPAQUE', `URL:${args.pageUrl}`, 'END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.map(foldLine).join('\r\n') + '\r\n'
}
