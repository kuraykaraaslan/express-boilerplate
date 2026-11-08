import { NextRequest } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import StatusSubscriberService from './status.subscriber.service'
import { confirmPage, htmlPage, readToken } from './status.subscriber.pages'

type Ctx = { params: Promise<{ tenantId: string }> }

const html = (body: string, status: number) => htmlPage(body, status)

/** The link in the confirmation mail. Plain HTML answer — the clicker is a
 *  mail client, not the SPA. A Slack or Teams subscriber's link only SHOWS a
 *  button here (a link preview must not confirm a subscription for a human);
 *  the button posts back and the POST below confirms. */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const token = new URL(request.url).searchParams.get('token') ?? ''
    if (token.length > 0 && await StatusSubscriberService.isChatToken(tenantId, 'verify', token)) {
      return confirmPage(token, 'Confirm subscription', 'Confirm that status updates may be posted to the channel this link came from.')
    }
    const ok = token.length > 0 && await StatusSubscriberService.verify(tenantId, token)
    const body = ok
      ? '<p>Subscription confirmed. You will receive status updates.</p>'
      : '<p>This confirmation link is invalid or was already used.</p>'
    return html(body, ok ? 200 : 400)
  } catch (e) {
    return normalizeError(e)
  }
}

/** The button of a chat subscriber's confirmation page (the token is the credential, in the URL or the form). */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const token = await readToken(request)
    const ok = token.length > 0 && await StatusSubscriberService.verify(tenantId, token)
    return html(ok ? '<p>Subscription confirmed. Status updates will be posted to the channel.</p>' : '<p>This confirmation link is invalid or was already used.</p>', ok ? 200 : 400)
  } catch (e) {
    return normalizeError(e)
  }
}
