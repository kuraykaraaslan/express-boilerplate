import { NextRequest } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import StatusSubscriberService from './status.subscriber.service'
import { confirmPage, htmlPage, readToken } from './status.subscriber.pages'

type Ctx = { params: Promise<{ tenantId: string }> }

const html = (body: string, status: number) => htmlPage(body, status)

/** One-click unsubscribe from every status mail's footer. Must work without
 *  any session, forever — the token is the whole credential. A Slack or Teams
 *  subscriber's link sits in a channel that bots read, so it only shows a
 *  button on GET (a link preview must not unsubscribe a channel); the POST acts. */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const token = new URL(request.url).searchParams.get('token') ?? ''
    if (token.length > 0 && await StatusSubscriberService.isChatToken(tenantId, 'unsubscribe', token)) {
      return confirmPage(token, 'Unsubscribe', 'Stop posting status updates to the channel this link came from.')
    }
    const ok = token.length > 0 && await StatusSubscriberService.unsubscribe(tenantId, token)
    const body = ok
      ? '<p>You are unsubscribed and will receive no further status emails.</p>'
      : '<p>This unsubscribe link is invalid or was already used.</p>'
    return html(body, ok ? 200 : 400)
  } catch (e) {
    return normalizeError(e)
  }
}

export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const token = await readToken(request)
    const ok = token.length > 0 && await StatusSubscriberService.unsubscribe(tenantId, token)
    return html(ok ? '<p>Unsubscribed. No further status updates will be posted.</p>' : '<p>This unsubscribe link is invalid or was already used.</p>', ok ? 200 : 400)
  } catch (e) {
    return normalizeError(e)
  }
}
