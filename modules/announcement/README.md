# announcement

One message to every user, on the right channels (docs/phases/47-announcements).

- **Who sends** (D15): the platform operator from the root tenant (behind the platform admin gate, `GLOBAL`) to every
  tenant, or chosen tenants, roles, plans and editions; a tenant admin to their own workspace. Permission
  `announcements.send` (ADMIN); `config/access.ts` can narrow it.
- **Channels**: `popup` (acknowledged once per person, D17; a `critical` one cannot be closed without OK), `toast` (to
  whoever is online, or opens the app within ten minutes), `banner`, `inapp` (the bell), `mail`, `push`, `sms`. A tenant
  admin has banner, toast, the bell and mail; popup, push and SMS are the platform's.
- **Text**: per language, written by hand, falling back to the default language (D19). The body is Markdown, sanitised by
  construction (`server/announcement.markdown.ts`: paragraphs, lists, bold, italic, code, safe links; never raw HTML).
- **Life cycle**: draft → scheduled → sending → sent → expired, or withdrawn. Withdrawing a sent one stops the popup and
  the banner and takes back the unread bell entries; mail cannot be recalled. A fan-out that keeps failing without
  progress ends **failed** (D23): after three restarts by the tick (`FANOUT_MAX_RESTARTS`) it is marked FAILED with the
  reason, audited (`announcement.failed`) and its sender is told on the bell and by mail; the sender retries it (from
  where it stopped) or withdraws it.
- **Mail** (D16): a general announcement is the category `announcement`, which users switch off in their preferences
  (`user_preferences.announcements`, opt-out); a maintenance notice is service mail (CRITICAL, no opt-out).
- **Safety**: preview of every channel in every language and a test send to oneself; the console confirms with the
  recipient count and the channels; at most one critical popup an hour per sender; a daily cap of announcements by mail
  per kind (`MAIL_DAILY_CAP`); every send, schedule, withdrawal, retry and test is audited.

## How it works

| Piece | File |
|---|---|
| Model | `server/entities/announcement.entity.ts` (`announcements`), `server/entities/announcement_receipt.entity.ts` (`announcement_receipts`, one per person reached); migration `server/migrations/001_announcements.sql` |
| Rules (channels per sender, language fallback, guards) | `server/announcement.rules.ts` |
| Audience (members of active tenants, roles, facets; deduplicated by user) | `server/announcement.audience.ts` |
| Delivery through the notification dispatcher (idempotency key `announcement:<id>`) | `server/announcement.delivery.ts` |
| Life cycle, fan-out body, recall, tick, give-up and retry (D23) | `server/announcement.service.ts` |
| A fan-out given up: the audit entry and the word to its sender | `server/announcement.failure.ts` |
| Queue (`fanout`, `recall`, minutely `tick`) | `server/announcement.job.ts` |
| The shell's read and the person's acknowledgements | `server/announcement.live.ts`, `ui/announcement-live.component.tsx` (`app_shell.banners`) |
| Maintenance notices (planned, reminder, start, end; unplanned on a forced start) | `server/announcement.maintenance.ts` |
| Console: the Maintenance page's "Announcements" drawer | `ui/announcements.drawer.tsx`, `ui/announcement-compose.component.tsx` |

The fan-out runs on the SYSTEM connection (a platform row has no tenant) in batches of 500 people, writes a receipt per
person, delivers the bell and push in each person's own workspace and mail and SMS from the sender (the root tenant for
a platform announcement), and after each batch signals the open shells of the workspaces that show it (for a platform
announcement every workspace its people are members of) over the in-app notification stream
(`common/server/announcement-live.channel`), which forwards it as the named event `announcements.live`
(`announcements.recall` after a withdrawal, so the bell reads its list again).

## Extension points

- `announcement:audience_facet` (aggregate): an audience axis another module knows. `tenant_subscription` contributes
  `plan`, `module_lifecycle` contributes `edition`. Fails closed for a facet in use.
- `announcement:mail_coverage` (aggregate): addresses another module already mails about the same maintenance moment.
  `observability` contributes its status-page subscribers, so a subscriber who is also a user gets one mail. Asked
  about a workspace window's start notice only (the status page mails nobody about a system window or a cancellation).

## API

`/api/announcements` (GET history, POST create), `/api/announcements/audience` (GET facets, POST count),
`/api/announcements/[id]` (GET, PATCH), `/api/announcements/[id]/send`, `/withdraw`, `/test`, `/retry` (a FAILED one),
`/api/announcements/live` (GET, the person's own), `/api/announcements/live/[id]` (POST seen / acknowledge / dismiss).
