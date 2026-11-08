# Notification Log Module

Unified outbound notification audit log. One row per delivery attempt across all channels (`mail`, `sms`, `push`, `inapp`). The channel-specific notification services (`notification_mail`, `notification_sms`, ...) call into this module from their BullMQ worker completion/failure handlers.

---

## What it does

- Persists `NotificationLog` rows to the tenant DB with channel, recipient, provider, status, optional `subject`, `providerMessageId`, and `error`.
- Powers admin "outbound deliveries" dashboards and per-user delivery history.
- Pairs with `tenant_usage` counters (`emailSends`, `smsSends`) — counters answer "how many", logs answer "to whom, by which provider, succeeded?".

---

## Entities

| Entity | Table | Description |
|---|---|---|
| `NotificationLog` | `notification_logs` | One write-once audit row per outbound delivery attempt |

Lives in the **tenant DB**. Indexed on `tenantId`, `channel`, `recipient`, and `status`; `recipient` holds an email / phone / userId depending on channel. `sentAt` is a `@CreateDateColumn`. Registered via `modules/db/db.ts`.

**Recipient at rest (P7-TDEK):** `recipient` is sealed under the tenant's data key (field-encryption v2) and its keyed blind index is stored in `recipientHash` (migration `001_notification_log_recipient_hash.sql`), so the exact `recipient` filter and `eraseForRecipient` find rows by the index (case and surrounding space ignored). `recipientSearch` (substring) can only reach legacy plaintext rows plus the exact value. Readers open the recipient in the row tenant's context only; a value that does not open reads `[unreadable]`. Destroying the tenant's key (purge) leaves recipients unreadable and unfindable. Declared on `db:tenant_key_columns` (`notification_log.tenant-key-columns.ts`).

Channel values: `mail | sms | push | inapp`. Status values: `sent | failed | pending`.

---

## Service

`NotificationLogService` (default export) is tenant-scoped — every method resolves the per-tenant DataSource via `tenantDataSourceFor(tenantId)`.

| Method | Responsibility |
|---|---|
| `log(tenantId, channel, recipient, status, opts?)` | Insert one audit row. Returns `null` (no-op) when `tenantId` or `recipient` is missing. Best-effort: any persistence error is swallowed and logged via `Logger.warn`, so the outbound notification flow is never blocked by audit-log unavailability. `provider` defaults to `'unknown'`. |
| `list(tenantId, query?)` | Paginated, filterable history (`channel`, `status`, `recipient`), ordered `sentAt DESC`. `limit` defaults to 50 and is capped at 200; `offset` defaults to 0. Returns `{ logs, total }`. |
| `getById(tenantId, id)` | Fetch a single row by `notificationLogId`, scoped to `tenantId`. |

---

## API

```ts
import NotificationLogService from '@/modules/notification_log/notification_log.service';

await NotificationLogService.log(tenantId, 'mail', 'user@example.com', 'sent', {
  subject: 'Welcome',
  provider: 'smtp',
  providerMessageId: '<abc@host>',
});

await NotificationLogService.log(tenantId, 'sms', '+12025551234', 'failed', {
  provider: 'twilio',
  error: 'Twilio: invalid recipient',
});

const { logs, total } = await NotificationLogService.list(tenantId, {
  channel: 'mail',
  status: 'failed',
  limit: 50,
});
```

`log()` swallows errors — outbound notification flow is never blocked by audit-log unavailability.

---

## Settings

This module has **no settings** — no per-tenant settings and no system-only settings. Behavior is fixed in code.

---

## Tenant Variability

> What varies per tenant in this module — and what could. Audited 2026-06-03.

Unified outbound notification audit log (mail, sms, push, inapp) with tenant-scoped write-once records; no per-tenant settings or behavior branches.

### Tenant-scoped data

| Entity | Table | Tenant-variable columns |
|---|---|---|
| `NotificationLog` | `notification_logs` | channel, recipient, subject, provider, status, providerMessageId, error |

All rows isolated by `tenantId` via the per-tenant DataSource.

---

## Failure-rate alert

`notification-log-failure-alert` (every 15 minutes, every active tenant; HTTP twin `POST /tenant/<id>/api/cron/notification-log-failure-alert`,
cron secret) runs `checkFailureRate`: when the last 30 minutes hold at least 20 attempts and half or more failed, the
`notification.failure_rate_high` webhook fires, at most once per tenant per hour. Before 2026-10-27 (MS-15) the check existed but
nothing called it.

---

## Dependencies

`db`, `tenant`. Consumed by `notification_mail` and `notification_sms` (which call `NotificationLogService.log` from their worker completion/failure handlers).

---

## Tasarım notları (eski Final Faz 16 backlog'undan, 2026-09-11)

- **Teslim durumu tek yerde.** Kanal modülleri (`notification_mail`/`_sms`/`_push`/`_inapp`) kendi
  durum/DLQ tablosunu açmaz; bir gönderimin kabul/başarısızlık/yeniden-deneme durumu bu ledger'dadır.
  Kalıcı başarısızlık = `failed` satırı (+ kuyruğun failed seti), ayrı bir "ölü mektup" deposu değil.
- **Ama bounce/complaint burada değil — backlog notu Karar 13 ile düzeltildi.** Eski backlog
  "bounce/complaint güncellemeleri sağlayıcı webhook'larından buraya akmalı" diyordu. CRM Karar 13
  (2026-08-09, `docs/phases/03-crm/05-communication-email-telephony/README.md` başı) ölçtü: sağlayıcılar bounce'u
  asenkron olay olarak bildirir, bu tablo ise yalnız "sağlayıcı kabul etti mi" sorusunu yanıtlar. Bounce
  defteri `mail_inbound.mail_bounces`'tır ve `contact_suppressions`'ı besler; gönderim kapısı
  dispatcher'ın `notification:suppression` noktasıdır.
- **Açık tasarım gerilimi:** Kesin listesindeki "write-once audit satırı" ile Olsa-iyi-olur'daki
  `pending → sent` / `sent → delivered` geçişleri çelişir. `notification_sms.delivery.service.
  handleDeliveryReceipt` bugün satırı yerinde güncelliyor (route'suz). Geçiş kalemleri yazılmadan önce
  ya "her olay yeni satır" ya da "yalnız `status` kolonu güncellenebilir" seçilmeli.
