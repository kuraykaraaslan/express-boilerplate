import type { StatusSubscriber } from './entities/status_subscriber.entity'

/**
 * What an operator may see of a subscriber (observability phase 15.5): the channel and a masked number, never a token, a signing key or a
 * full endpoint URL (which can carry a secret of the receiver's own in its path or query). A pure projection, so a test can hold it to
 * an exact key list.
 */
export function subscriberAdminView(s: Pick<StatusSubscriber, 'subscriberId' | 'channel' | 'email' | 'phone' | 'endpointUrl' | 'chatUrlHost' | 'verifiedAt' | 'componentIds' | 'pageId' | 'locale' | 'createdAt'>) {
  return {
    subscriberId: s.subscriberId,
    channel: s.channel ?? 'EMAIL',
    email: s.email ?? null,
    phone: s.phone ? `${s.phone.slice(0, 4)}...${s.phone.slice(-2)}` : null,
    // A Slack / Teams destination shows its host only: the path of its URL is the credential and is not even read here.
    endpointHost: s.endpointUrl ? hostOf(s.endpointUrl) : (s.chatUrlHost ?? null),
    verifiedAt: s.verifiedAt ?? null,
    componentIds: s.componentIds ?? null,
    pageId: s.pageId ?? null,
    locale: s.locale ?? null,
    createdAt: s.createdAt,
  }
}

function hostOf(url: string): string | null {
  try { return new URL(url).host } catch { return null }
}
