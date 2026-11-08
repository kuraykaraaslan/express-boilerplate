# Notification Inapp Module

Real-time in-app notification feed backed by Redis. Stores per-user notifications in a hash (capped, TTL'd), tracks read status in a separate set, streams new items over Redis pub/sub (SSE), and auto-fans-out to push notifications. Fully tenant-scoped: `tenantId` is embedded in every Redis key and channel.

---

## Files

| File | Purpose |
|---|---|
| `notification_inapp.service.ts` | Core: push/broadcast, list, read/unread, delete, Redis storage + pub/sub |
| `notification_inapp.types.ts` | `Notification` (Zod `NotificationSchema`) and `NotificationPayload` |
| `notification_inapp.messages.ts` | `NotificationInAppMessages` enum of message string keys |
| `notification_inapp.service.test.ts` | Service unit tests |

The `inapp` channel (`notification_inapp.channel.ts`, a `notification:channel` contribution) stores the event's title, `body` and `data`, but never `data.html` (the mail's body: a domain's rendered template or `action.notify`'s sanitised HTML) or `event.attachments`: the feed shows the text form. The page a notification opens is `data.path`, or its aliases `data.link` and `data.url` (the deep link `notification_external` reads), the first that is an internal app path (`notification_inapp.target.ts`: a leading `/`, no `//`, no backslash, no control character); anything else is dropped, never stored (docs/phases/07-dashboard/40, D40-15). `pushRaw` applies the same rule to a direct caller's `path`, and keeps an `action` only as `{ label, url }`.

### The bell

`ui/notification-topbar.component.tsx` is the top bar's one bell (common's `NotificationMenu`), with one list (D40-16): the notifications and the items other modules hand up through the `notification_inapp.bell` slot (`onItems(key, source)`; the IoT alarms do), newest first, with a filter All / <source> / Notifications. A click on a notification marks it read (`PUT …/notifications/[notificationId]`) and opens its page inside the app (client navigation): its `path`, else its action's URL when that is an internal path, under the current tenant's prefix; an external URL is never opened. Relative times are written in the app's language.

---

## Notification Shape

Validated by `NotificationSchema` (Zod) in `notification_inapp.types.ts`:

```typescript
type Notification = {
  notificationId: string;  // uuid
  title: string;
  message: string;
  path?: string | null;    // the page a click opens: an internal app path (`/admin/...`), else null
  action?: { label: string; url: string } | null; // a call to action; the bell opens its url only as an internal path
  isRead: boolean;         // resolved from the read-set at read time
  createdAt: string;       // ISO datetime
};

type NotificationPayload = Pick<Notification, "title" | "message" | "path">;
```

---

## Service / Responsibilities

`NotificationInAppService` (all methods are `static` and take `tenantId` first):

| Method | Responsibility |
|---|---|
| `push(tenantId, userId, data)` | Create a notification, store it, trim to cap, publish to pub/sub, and fire a push notification. Returns the created `Notification`. |
| `pushToUsers(tenantId, userIds[], data)` | `push` to an explicit list of users. |
| `pushToRole(tenantId, role, data)` | Push to every `ACTIVE` `TenantMember` with the given `memberRole` (resolved from the tenant DB). |
| `pushToAdmins(tenantId, data)` | `pushToRole` with role `ADMIN`. |
| `pushToAll(tenantId, data)` | Push to every `ACTIVE` member of the tenant. Single-tenant by design — no cross-tenant broadcast. |
| `getAll(tenantId, userId)` | Read the inbox hash, merge read state from the read-set, return newest-first. |
| `unreadCount(tenantId, userId)` | Count notifications not in the read-set. |
| `markAsRead(tenantId, userId, notificationId)` | Add one id to the read-set. |
| `markAllAsRead(tenantId, userId)` | Add all current ids to the read-set. |
| `deleteOne(tenantId, userId, notificationId)` | Remove one id from both inbox hash and read-set. |
| `clearAll(tenantId, userId)` | Delete the entire inbox hash and read-set. |
| `channel(tenantId, userId)` | Pub/sub channel name for the user (used by the SSE route). |
| `createSubscriber()` | Open a dedicated Redis connection for subscribing (SSE). |

On every `push`, `NotificationPushService.sendToUser(tenantId, userId, { title, body, url })` is invoked fire-and-forget (failures swallowed) so the in-app write never depends on the push pipeline.

---

## Storage

- Inbox hash: `notifications:{tenantId}:{userId}` — one field per notification (keyed by `notificationId`), `7-day` TTL refreshed on each push.
- Read-set: `notifications_read:{tenantId}:{userId}` — set of read `notificationId`s, same TTL (the tenant's `inAppRetentionDays`; before 2026-10-27 it was always 7 days). `isRead` is derived from this set at read time, not stored on the notification.
- Pub/sub channel: `notifications:tenant:{tenantId}:user:{userId}` — each push is published here; the SSE route subscribes per connection.
- Cap: the inbox is trimmed to the newest `MAX_PER_USER` (50) entries on each push; the oldest are `HDEL`'d.

---

## API Routes (tenant-scoped, authenticated user)

All routes resolve the caller via `TenantSessionNextService.authenticateTenantByRequest` and act on that user's tenant-scoped inbox. Mutating/listing routes are rate-limited via `Limiter.checkRateLimit`.

| Method | Path | Description |
|---|---|---|
| GET | `/tenant/[tenantId]/api/auth/me/notifications` | List the caller's notifications (newest first). |
| DELETE | `/tenant/[tenantId]/api/auth/me/notifications` | Clear the entire inbox. |
| GET | `/tenant/[tenantId]/api/auth/me/notifications/stream` | SSE stream of new notifications (subscribes to the tenant-scoped channel; `force-dynamic`, Node runtime, keep-alive ping every 25s). |
| PUT | `/tenant/[tenantId]/api/auth/me/notifications/read-all` | Mark all notifications as read. |
| PUT | `/tenant/[tenantId]/api/auth/me/notifications/[notificationId]` | Mark one notification as read. |
| DELETE | `/tenant/[tenantId]/api/auth/me/notifications/[notificationId]` | Remove one notification. |

---

## Sending a Notification

```typescript
import NotificationInAppService from '@/modules/notification_inapp/notification_inapp.service';

// To a single user (tenantId is required and partitions storage + delivery):
await NotificationInAppService.push(tenantId, userId, {
  title: 'Invitation accepted',
  message: 'John Doe joined your workspace.',
  path: '/admin/members', // an app path: the bell puts the tenant's prefix in front of it
});

// Broadcast to a role or the whole tenant:
await NotificationInAppService.pushToAdmins(tenantId, {
  title: 'New signup',
  message: 'A new member is awaiting approval.',
});
```

---

## Settings

Per-tenant keys (`server/notification_inapp.setting.keys.ts`, 2026-10-27):

| Key | Purpose | Default |
|---|---|---|
| `inAppRetentionDays` | Days a member's feed and its read marks are kept after the last new item (1..365, else the default). Settings → In-app Notifications (`/admin/settings/in-app-notifications`, `notification_inapp.settings.read`). | `7` |
| `inAppQuietHours` | Legacy `"HH:MM-HH:MM"` server-time window holding back the push fan-out of a direct `push()`. No field: quiet hours are the notification module's model. | none |

`MAX_PER_USER` (50) stays a constant: the top bar shows at most 50 live items.

---

## Tenant Variability

> What varies per tenant in this module — and what could. Audited 2026-06-03.

A Redis-backed in-app notification feed (inbox hash, read-set, pub/sub) that is fully tenant-scoped by embedding tenantId in every Redis key and channel, but exposes no per-tenant configurable settings — its limits are hardcoded globals.

### Per-tenant behavior

- `notification_inapp.service.ts` — All Redis storage and delivery is partitioned by tenantId: inbox hash `notifications:{tenantId}:{userId}`, read-set `notifications_read:{tenantId}:{userId}`, and pub/sub channel `notifications:tenant:{tenantId}:user:{userId}` (notifKey/readKey/channel helpers, lines 21-26). The same userId in tenant A can never read tenant B's notifications.
- `notification_inapp.service.ts:pushToRole/pushToAll` — Audience resolution is per-tenant: it opens the tenant DB via tenantDataSourceFor(tenantId) and queries the TenantMember repository filtered by tenantId/memberRole/memberStatus, so broadcasts (pushToRole, pushToAdmins, pushToAll) target only that tenant's active members — there is no cross-tenant broadcast by design.
- `notification_inapp.service.ts:push` — On every push it fires NotificationPushService.sendToUser(tenantId, userId, ...) (line 65), fanning out to the per-tenant push-notification pipeline (which itself resolves provider/keys per tenant).

### Candidates (global / hardcoded today → could be per-tenant)

| What | Where | Why per-tenant | Suggested key |
|---|---|---|---|
| Per-user notification retention cap is a hardcoded global of 50 | `notification_inapp.service.ts:MAX_PER_USER` | Defined as `static MAX_PER_USER = 50` (line 28) and applied in push() when trimming the oldest entries (lines 54-60). Identical for every tenant; a higher-tier tenant might warrant a larger inbox. Plausibly a per-tenant setting, but could also be argued as shared infra sizing. | `inAppMaxPerUser` |
| Notification TTL is a hardcoded global of 7 days | `notification_inapp.service.ts:TTL` | Defined as `static TTL = 7 * 24 * 60 * 60` (line 29) and used on every redis.expire for both inbox and read-set (lines 51, 139, 147). Retention duration is uniform across tenants; tenants may want different retention windows, so it is a reasonable per-tenant candidate. | `inAppRetentionSeconds` |

---

## Dependencies

- `@/modules/redis` — storage (hash, set), `expire`, pub/sub, and dedicated subscriber connections.
- `@/modules/db` (`tenantDataSourceFor`) + `@/modules/tenant_member` (`TenantMember`) — audience resolution for role/all broadcasts.
- `@/modules/notification_push` (`NotificationPushService`) — push fan-out on every `push`.
- `@kuraykaraaslan-labs/tenant_session/server/tenant_session.service.next` + `@kuraykaraaslan-labs/limiter/server/limiter.rate-limiters` — auth and rate limiting in the API routes.

Declared in `module.json`: `requires: ["db", "user"]`.

---

## Tasarım notları (eski Final Faz 16 backlog'undan, 2026-09-11)

- **Feed'in yeniden bağlanması SSE'de değil gateway'de çözülür.** Backlog'un ortak konvansiyonu
  "realtime (feed/mesaj reconnect) `websocket` shared gateway üzerinden" diyordu; audit §5 aynı yönü
  kaydeder ("notification SSE'si buraya katlanır"), telephony 2026-08-05 kararı ikinci bir SSE
  transport'u açmaz. Bu yüzden SSE'ye özgü `Last-Event-ID` replay'i **reddedildi**: kaçırılan
  bildirimin kaynağı zaten kalıcıdır (Redis gelen kutusu), yeniden bağlanan istemci `getAll`'ı yeniden
  okur. Geçiş yapılana kadar asgari düzeltme: `hooks/use-notifications.hook.ts` `onerror`'da akışı
  kapatmamalı (bugün kapatıyor, tarayıcının yerleşik yeniden bağlanması ölü).
- **Zamanlama, dil, alıcı kitlesi merkezde.** Scheduled gönderim, metnin alıcı diline çevrilmesi ve
  "tenant'ın ADMIN'leri" gibi rol kitlesi `notification` dispatcher'ının işidir; bu kanal render
  edilmiş metni saklar ve yayar (`pushRaw`). Kanal başına ayrı zamanlayıcı açılmaz.
