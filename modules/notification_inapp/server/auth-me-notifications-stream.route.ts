// path: app/tenant/[tenantId]/api/auth/me/notifications/stream/route.ts
import { NextRequest } from "next/server";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import NotificationInAppService from "@kuraykaraaslan-labs/notification_inapp/server/notification_inapp.service";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { extensionStateChannel, EXTENSION_STATE_EVENT } from "@kuraykaraaslan-labs/common/server/extensions/extension-state.channel";
import { announcementLiveChannel, ANNOUNCEMENT_LIVE_EVENT, ANNOUNCEMENT_RECALL_EVENT, ANNOUNCEMENT_RECALL_SIGNAL } from "@kuraykaraaslan-labs/common/server/announcement-live.channel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /tenant/[tenantId]/api/auth/me/notifications/stream
 * Server-Sent Events stream of new notifications for the authenticated user,
 * subscribed only to the tenant-scoped pub/sub channel — no cross-tenant
 * inbox bleed possible. It also forwards this tenant's "the modules changed"
 * announcements (and the platform-wide ones) as an `extensions.state` event, and
 * "an announcement went out to this tenant" (docs/phases/47-announcements) as an
 * `announcements.live` event (`announcements.recall` for a withdrawal): one
 * stream per session, not three.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'notification_inapp.stream.read', scope: 'TENANT' });
    const channel = NotificationInAppService.channel(tenantId, user.userId);
    const subscriber = NotificationInAppService.createSubscriber();
    // Everything one connection holds — the dedicated Redis subscriber and the keep-alive timer — is released through
    // `close`, from whichever way the connection ends: the request abort, the consumer cancelling the stream, or a failed
    // subscribe. `start` awaits `subscribe`, so a client that leaves during it has already fired `abort` before a listener
    // was attached: `closed` is checked after every await, or that subscriber and timer would live forever.
    let closed = false;
    let ping: ReturnType<typeof setInterval> | undefined;
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;
    const close = () => {
      if (closed) return;
      closed = true;
      if (ping) clearInterval(ping);
      subscriber.quit().catch(() => { });
      try { controllerRef?.close(); } catch { /* ignore */ }
    };
    request.signal.addEventListener("abort", close, { once: true });

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controllerRef = controller;
        const encoder = new TextEncoder();

        const send = (data: string) => {
          try { controller.enqueue(encoder.encode(`data: ${data}\n\n`)); } catch { close(); }
        };

        if (closed || request.signal.aborted) { close(); return; }
        // The same connection also carries "the modules changed" (docs/phases/37-extensions/05), as a named event the
        // notification list ignores: one stream per session, not two.
        const stateChannels = new Set([extensionStateChannel(tenantId), extensionStateChannel('*')]);
        const liveChannel = announcementLiveChannel(tenantId);
        try {
          await subscriber.subscribe(channel, ...stateChannels, liveChannel);
        } catch {
          close();
          return;
        }
        if (closed) return;
        subscriber.on("message", (chan, msg) => {
          // A named event carries nothing: the listener reads what changed itself.
          const named = chan === liveChannel
            ? (msg === ANNOUNCEMENT_RECALL_SIGNAL ? ANNOUNCEMENT_RECALL_EVENT : ANNOUNCEMENT_LIVE_EVENT)
            : stateChannels.has(chan) ? EXTENSION_STATE_EVENT : null;
          if (!named) { send(msg); return; }
          try { controller.enqueue(encoder.encode(`event: ${named}\ndata: {}\n\n`)); } catch { close(); }
        });

        // keep-alive ping
        ping = setInterval(() => {
          try { controller.enqueue(encoder.encode(`: ping\n\n`)); } catch { close(); }
        }, 25_000);
      },
      cancel: close,
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        // nginx buffers proxied responses by default, which holds every event
        // until the buffer fills — the stream looks dead rather than broken.
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e) {
    return normalizeError(e);
  }
}
