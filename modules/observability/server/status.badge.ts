import { esc, statusHex, statusLabel } from './status.render'

/**
 * The SVG status badge (observability phase 15.8). A flat two-part badge, the width computed from the text so nothing is clipped.
 * Built from three strings and a status name: it holds no script, no external reference and no tenant markup, and every string is
 * escaped. The label is a component or page name that is already public.
 */

const CHAR_W = 6.4
const PAD = 10
const MAX_TEXT = 40

function clip(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT - 1)}…` : t
}

export function buildBadgeSvg(args: { label: string; status: string }): string {
  const label = clip(args.label) || 'status'
  const message = statusLabel(args.status)
  const lw = Math.round(label.length * CHAR_W + PAD * 2)
  const mw = Math.round(message.length * CHAR_W + PAD * 2)
  const w = lw + mw
  const color = statusHex(args.status)
  const title = `${label}: ${message}`
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${esc(title)}">`,
    `<title>${esc(title)}</title>`,
    `<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>`,
    `<clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>`,
    `<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#555"/><rect x="${lw}" width="${mw}" height="20" fill="${color}"/><rect width="${w}" height="20" fill="url(#s)"/></g>`,
    `<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">`,
    `<text x="${lw / 2}" y="14">${esc(label)}</text><text x="${lw + mw / 2}" y="14">${esc(message)}</text></g></svg>`,
  ].join('')
}
