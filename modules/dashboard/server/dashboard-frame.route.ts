import { NextRequest } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { dashboardContext } from './dashboard.route.helpers'

type Ctx = { params: Promise<{ tenantId: string }> }

/**
 * The policy a template widget runs under (decision 2026-10-17 #8).
 *
 * A template used to go in through `srcdoc`, and a `srcdoc` document inherits the EMBEDDING page's policy. With
 * `CSP_STRICT=true` that policy names a nonce, so every inline `<script>`/`<style>` in the frame, the host's own
 * resize and click bridge included, was blocked, and no nonce could rescue a template's `style="…"` attributes or
 * inline handlers. A document fetched from a URL gets the policy of ITS response instead, so the frame now loads
 * this fixed shell and the policy below is the template's whole world, whatever the app's policy is:
 *
 * - `sandbox allow-scripts`: the same sandbox as the iframe attribute, so the shell is opaque-origin even when
 *   someone opens this URL directly.
 * - inline script and style only: a template ships as one document and never loads code from anywhere.
 * - `connect-src 'none'`, `form-action 'none'`: a template's data comes in through its slots, so it has no
 *   reason to call out. (Images and media still load over `https:`, because templates show logos; that is a
 *   channel a template author could use, and the author is a tenant user with `dashboard.widgets.manage`.)
 * - `frame-ancestors 'self'`: only this app can frame it.
 *
 * The proxy leaves a route's own `Content-Security-Policy` alone (`proxy/csp.ts` `withSecurityHeaders`).
 */
export const FRAME_CSP = [
  'sandbox allow-scripts',
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob: https:',
  'font-src data: https:',
  'media-src data: blob: https:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
].join('; ')

/**
 * The shell. It says `widgetReady` to its parent, takes ONE `widgetRender` from the parent window only, and
 * writes that document over itself. `document.write` keeps this Document, and with it the policy above. A later
 * render is ignored: the host remounts the frame for a new document, so no state of an earlier one survives.
 */
export const FRAME_SHELL = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>
(function(){
  var done=false;
  addEventListener('message',function(e){
    if(done||e.source!==parent)return;
    var d=e.data;
    if(!d||d.type!=='widgetRender'||typeof d.html!=='string')return;
    done=true;
    document.open();document.write(d.html);document.close();
  });
  parent.postMessage({type:'widgetReady'},'*');
})();
</script></body></html>`

/**
 * GET …/dashboard/frame: the shell a template widget's iframe loads. It carries no tenant data, but it is guarded like
 * every dashboard route (the iframe's request comes from the app page and carries the session). A display link's
 * screen, which has no session, loads the same shell from `dashboard-display-frame.route.ts` (POSTURE §13).
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    await dashboardContext({ request, tenantId, requiredPermission: 'dashboard.boards.read' })
    return new Response(FRAME_SHELL, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': FRAME_CSP,
      },
    })
  } catch (e) {
    return normalizeError(e)
  }
}
