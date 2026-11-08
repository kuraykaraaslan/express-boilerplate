import { headers } from 'next/headers'

/**
 * The per-request CSP nonce, for server components that emit inline
 * `<style>`/`<script>` (phase 6 §D).
 *
 * ## The split, and why it is this way round
 *
 * PRODUCING the nonce is the app layer's job — `proxy.ts` mints one per request,
 * forwards it as the `x-nonce` request header and names it in the
 * `Content-Security-Policy` it sets. A module cannot do that: only the
 * middleware sees every request, and a policy is a property of the response, not
 * of one component inside it.
 *
 * CONSUMING it is each emitter's job, and it reads the header itself rather than
 * receiving a prop. Threading a nonce down through `SiteChrome` → layout →
 * blocks would mean every component between the middleware and the `<style>`
 * carrying a value it does not use, and one forgotten hand-off silently produces
 * a tag that a strict policy blocks — a bug that only appears once the policy is
 * turned on, in production, on someone else's site.
 *
 * ## Absent by design
 *
 * `undefined` when no nonce was minted, which is the normal state while the
 * platform still ships `'unsafe-inline'` (see POSTURE). Emitters spread the
 * result, so `nonce={undefined}` renders no attribute at all and the markup is
 * byte-identical to before. Nothing here changes behaviour until the policy
 * does.
 *
 * Not memoised with React's `cache()` — a module's server layer stays
 * framework-agnostic (there is a lint rule) and `headers()` is already a
 * per-request read Next dedupes itself, so the wrapper would buy nothing.
 */
export const CSP_NONCE_HEADER = 'x-nonce'

/**
 * The API path browsers post CSP violation reports to (seo's report route, docs/phases/38-security/04 4.2), under the tenant's API. Named
 * here because three layers need it: the proxy names it in the Report-Only policy, the route serves it, and the limiter never counts it
 * against a person or an address (docs/phases/07-dashboard/40-data-traffic.md, D40-14).
 */
export const CSP_REPORT_API_PATH = '/api/seo/csp-report'

export async function cspNonce(): Promise<string | undefined> {
  try {
    const h = await headers()
    return h.get(CSP_NONCE_HEADER) ?? undefined
  } catch {
    // `headers()` throws outside a request scope (a build-time render, a unit
    // test). No nonce is the correct answer there, not a crash.
    return undefined
  }
}

/**
 * The nonce for an emitter that renders on EVERY page (the root layout's boot scripts), only while the policy
 * enforces it (`enforced`: `env.CSP_STRICT`, passed in so this file stays free of the env schema the proxy does not
 * load). Reading request headers makes a route dynamic, so an unconditional read in the root layout would turn every
 * static page dynamic to stamp a nonce no policy asks for. With the flag on, pages are request-rendered anyway: a
 * per-request nonce cannot live in a prerendered page.
 */
export async function strictCspNonce(enforced: boolean): Promise<string | undefined> {
  return enforced ? cspNonce() : undefined
}

/**
 * Mint one. Base64 of 16 random bytes — the length the CSP spec recommends, and
 * `crypto.getRandomValues` so it works in the edge runtime where `node:crypto`
 * is not available.
 */
export function mintCspNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}
