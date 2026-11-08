import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { cspNonce } from '@kuraykaraaslan-labs/common/server/csp'

/**
 * The pages behind the Slack / Teams subscriber links (observability 15.5). The link sits in a channel that bots read (link previews, safe-link
 * scanners), so a GET only shows a button; the POST behind it acts. The token is a base64url string (`A-Za-z0-9_-`) and is placed into the page
 * only after that shape is checked.
 *
 * CSRF: the central gate rejects a state-changing request that carries a session cookie but no CSRF header, and a plain form post cannot add
 * one. These routes never read a cookie (the token is the whole credential), so the button submits with a few lines of script and
 * `credentials: 'omit'`: a person who happens to be signed in to the app in the same browser can still confirm. Without script the form posts
 * normally, which works for anybody without a session cookie. (Same arrangement as the on-call acknowledge links.)
 */
const TOKEN = /^[A-Za-z0-9_-]{1,64}$/

const HEADERS = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, max-age=0', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' } as const

const SCRIPT = `
const form = document.getElementById('confirm');
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const res = await fetch(location.pathname + location.search, { method: 'POST', credentials: 'omit' });
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    document.body.innerHTML = doc.body.innerHTML;
  } catch { form.submit(); }
});`

export function htmlPage(inner: string, status: number): NextResponse {
  return new NextResponse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Status updates</title></head><body>${inner}</body></html>`, { status, headers: HEADERS })
}

/** The page with one button. The token stays in the URL (the script posts to the same URL), and in a hidden field for the no-script case. */
export async function confirmPage(token: string, label: string, text: string): Promise<NextResponse> {
  if (!TOKEN.test(token)) return htmlPage('<p>This link is invalid or was already used.</p>', 400)
  const nonce = await cspNonce().catch(() => null)
  const attr = nonce && /^[A-Za-z0-9+/=_-]+$/.test(nonce) ? ` nonce="${nonce}"` : ''
  return htmlPage(
    `<p>${text}</p><form id="confirm" method="post"><input type="hidden" name="token" value="${token}"><button type="submit">${label}</button></form><script${attr}>${SCRIPT}</script>`,
    200,
  )
}

/** The token of a POST: the query string (the script) or the form body (the no-script button): the same credential either way. */
export async function readToken(request: NextRequest): Promise<string> {
  const fromQuery = new URL(request.url).searchParams.get('token')
  if (fromQuery) return fromQuery.slice(0, 64)
  try {
    if ((request.headers.get('content-type') ?? '').includes('application/x-www-form-urlencoded')) {
      return (new URLSearchParams(await request.text()).get('token') ?? '').slice(0, 64)
    }
  } catch { /* an unreadable body is an empty token */ }
  return ''
}
