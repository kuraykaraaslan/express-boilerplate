# Notification Module

**The platform's notification dispatcher.** One place that answers "should this
notification reach this person, on which channels, right now?" — and one place
that fans it out.

## Why it exists

The platform had four channel modules (`notification_mail`, `notification_sms`,
`notification_push`, `notification_inapp`) and a delivery ledger
(`notification_log`), but no orchestrator. Every domain picked a channel module
and called it directly, so policy was applied by whichever channel felt like it:

- **24 modules called the mail service directly**, addressing recipients by bare
  email string. A bare email cannot be resolved to a user, so no preference could
  be consulted — the account settings page's "Email notifications" toggle gated
  **nothing**, including the new-login alerts it explicitly promises.
- **`messaging` pushed under no policy at all.** A recipient who had switched
  push off still got pushed.
- **Quiet hours existed twice, incompatibly.** `inAppQuietHours` was an
  `"HH:MM-HH:MM"` string evaluated in *server* time; `pushQuietHoursStart`/`End`
  were whole-hour numbers evaluated in the *user's* timezone.
- `notification_inapp` had drifted into a half-orchestrator, hosting its sibling
  modules' API routes.

## The contract

```ts
import NotificationService from '@kuraykaraaslan-labs/notification/server/notification.service'

await NotificationService.notify(
  tenantId,
  { userId, email, phone },            // a recipient, or an array of them
  {
    event: 'invoice.issued',           // stable id; what the ledger records
    category: 'billing',               // drives per-category opt-outs
    title: 'Your invoice is ready',
    body: 'Invoice #1042 — €120.00',
    data: { html: renderedTemplate },  // channel-specific payload
  },
  { channels: ['mail'], idempotencyKey: `invoice:${invoiceId}` },
)
```

A call with an `idempotencyKey` delivers each recipient and channel at most once: the key each channel
receives is `<key>:<recipient>:<channel>`, so one key can cover a whole recipient list. The mail channel reads
`data.subject` (replaces the title as the subject line) and `data.replyTo` (one plain address) besides `data.html`.

Files go in `event.attachments` (G-076), **beside** `data`, never in it: the in-app and push channels copy `data` into
their rows and payloads, and base64 must not reach a feed row or a push message. Each file is
`{ filename, contentBase64, contentType?, cid? }` (JSON-safe, `NotificationAttachmentSchema`, at most
`MAX_NOTIFICATION_ATTACHMENTS` = 10; `contentType` limited to a leaf top-level type, `application`, `image`, `text`,
`audio`, `video` or `font`, so never `message/*` or `multipart/*`); a file with a `cid` is an inline image an HTML body shows as `cid:<id>`. Only the mail
channel reads them; it checks and decodes them before queueing, so a bad or oversized file fails that delivery (recorded as
`failed`), and on a plain body it shows inline images below the text. `action.notify` (the automation node) fills this
from its `attachments` rows (1 MiB of file data per call, contents from the message or context, never fetched from a URL).
`format: html` on that node (G-072, done): the text is rendered with every substituted value HTML-escaped, cut down by
`sanitizeNotificationHtml` (`server/notification.html.ts`, `sanitize-html` with a strict allowlist: basic formatting, lists,
tables; links `http`/`https`/`mailto` only, each with `rel="noopener noreferrer"`; images `cid:` of the call's own inline files
or `https` only; no `style`, `class`, handlers, `script`, `iframe`, `svg`, `data:` URLs) and sent as `data.html`; `body` is
`notificationHtmlToText` of the same HTML, so every channel but mail gets text. The in-app and push channels never copy
`data.html` into their rows and payloads (it is the mail's body, and a rendered template does not fit a push payload).
The node's event `data` is `{ flowId, nodeId, runId }` plus the mail options.

A channel may answer its monthly quota read-only through `quota(tenantId)` (`{ allowed, key, reason? }`; the mail and SMS channels
use their queue's `monthlyQuota`, the same gate and usage read as the send, counting nothing; `reason` is `spent` or `no_access`,
the latter for an undeclared key, no live plan or a limit of 0). `NotificationService.spentQuotas(tenantId, channels)` lists every
asked channel without room. `action.notify` asks before sending: a channel without room is dropped from the send and named in
`metadata.notify.quota`, and the other channels still go out; only when every channel the call would use is without room does it
answer `limit` with `{ key: 'feature_email_monthly_quota' | 'feature_sms_monthly_quota', scope: 'plan' }` (G-137), since the queue
enforces the quota later, where the flow never sees it. A redelivery is not refused for a quota spent since: the node passes
`spentQuotas` its `replay` (`{ idempotencyKey, recipients }`), and a channel without room on which a send of the call already
completed (`provider.completed(tenantId, derivedKey)`, the mail and SMS channels read their `RedisIdempotencyService` record)
is not listed; the mail and SMS queues return a completed send's recorded result before their quota gate.
The node's editor (`ui/notification-notify.node-ui.tsx`, an `automation:node_ui` contribution, G-154) keeps the generated
form and makes each recipient row's value suggest the `notification.recipients` choices (members for `user`, roles for `role`).

`recipients` carry a `userId` **on purpose**: it is the thing that makes
preference resolution possible at all.

### Urgency — the security exemption

```ts
await NotificationService.notifyCritical(tenantId, recipient, { event: 'auth.otp', … })
```

`CRITICAL` skips every recipient-controlled gate: channel toggle, category
opt-out, quiet hours. It is for mail and codes a person needs in order to stay in
control of their account — OTP, password reset, new-device warnings. Suppressing
those because "email notifications: off" would turn a preference toggle into a
way to lock yourself out.

It does **not** skip the tenant-wide kill switch
(`disabledNotificationChannels`): a tenant with no SMS provider configured cannot
deliver an SMS however urgent it is.

`auth.new_login` is deliberately **NORMAL**, not critical — knowing that a login
happened is informational, not an account-recovery credential, and a user who
turned those emails off asked for exactly that.

### What the policy resolves

| Gate | Applies to | Skipped by CRITICAL |
|---|---|---|
| `not_requested` — caller's `channels` filter | all | — (caller's own choice) |
| `tenant_disabled` — `disabledNotificationChannels` | all | **no** |
| `address_suppressed` — the ADDRESS opted out, bounced or complained | mail, sms | **no** |
| `channel_off` — `emailNotifications` / `smsNotifications` / `pushNotifications` | mail, sms, push | yes |
| `category_opt_out` — `newsletter` / `productUpdates` / `promotionalOffers` | all | yes |
| `quiet_hours` — the single quiet-hours model | push, sms | yes |
| `no_address` — provider reports nothing to deliver to | per channel | — (physical) |

In-app has no channel toggle: it is the feed inside the product, and a user who
does not want it simply does not open it. Mail is never deferred by quiet hours —
a deferred email is just a late email, and holding it back only makes the inbox
lie about ordering.

### The address gate (`notification:suppression`)

Preferences answer *does this **person** want this?* and need an account.
Suppression answers *may we write to this **address** at all?* and works on a
guest, a bounced mailbox, or somebody who never had a login. Both are consulted;
neither substitutes for the other.

It arrives through an extension point, not an import: the only gate today is
`contact`'s suppression list, and `notification` is platform core — importing a
CRM domain from it would invert the dependency and cycle, since `contact`
already sends through the dispatcher.

**It is checked BEFORE the CRITICAL exemption, and that placement is the
decision.** `CRITICAL` waives what the RECIPIENT chose — their toggles, their
quiet hours — so a preference can never lock somebody out of their own account.
It does not waive what the ADDRESS *is*: a hard bounce is a fact about a
mailbox and a full opt-out is a legal boundary, and neither changes because our
message is urgent. What CRITICAL does buy is the **purpose**: a security notice
is transactional, so a marketing unsubscribe never touches it.

`purpose` is **derived**, not demanded — `CRITICAL` ⇒ transactional, a marketing
category ⇒ marketing. A caller required to declare it would eventually declare
it wrong, and the wrong direction is the unlawful one. `opts.purpose` overrides
it for the caller that genuinely knows better (an abandoned-cart reminder is
marketing however operational its category looks, because abandoning a cart is
not a request).

Providers **fail closed** (an address they cannot evaluate is suppressed). The
dispatcher runs them as a guard (docs/phases/37-extensions, EXT-3), and what a
provider that throws, times out or fails to load means depends on the purpose:
**transactional** (and so every `CRITICAL`) traffic **fails open** — a broken
provider knows nothing about anybody, and silencing password resets and receipts
platform-wide because a CRM module failed to load is a far larger outage than the
one it prevents; **marketing fails closed** — the addresses that provider judges
(every address kind when it failed before saying) are held back with the reason
`address_unverifiable`, because mailing somebody who unsubscribed is the unlawful
direction and a missed newsletter is only a retry. The point declares exactly
this `failOpen`; a provider whose module is not active for the tenant is not
asked.

Before this moved into the policy (2026-09-03) the gate lived in
`contact.dispatch.outboundNotify`, so only callers who went through that helper
consulted it. After the PLAT-01 sweep most of the platform calls `notify()`
directly — every one of those sends was skipping it. **An unsubscribe that only
some senders honour is not an unsubscribe.**

### Quiet hours — one model

Resolved in the **recipient's** timezone (`notificationQuietHoursStart`/`End`,
whole hours, may wrap midnight). A quiet window is about when the recipient is
asleep, not the server, so the user-timezone model won. The legacy
`inAppQuietHours` string is still *read* for tenants that configured it, and is
no longer written.

### Diagnosing "why didn't I get that email?"

```ts
await NotificationService.explain(tenantId, recipient, event, opts)
// → { urgency, allowed: [...], decisions: [{ channel, allowed, reason }] }
```

Previously unanswerable.

## PLAT-01 migration — who still bypasses the dispatcher

The audit's finding was that 24 modules called the mail service directly with a
bare address and consulted nothing, so the account settings page's "Email
notifications" toggle gated nothing at all.

**Migrated so far** — the account-control group, which is where a bypass hurts
most and where the classification is unambiguous:

| module | notice | urgency |
|---|---|---|
| `user_security` | account locked | CRITICAL |
| `auth_passkey` | passkey registered / removed | CRITICAL |
| `auth_impersonation` | someone is acting as you (start / end) | CRITICAL |
| `user_social_account` | identity provider linked / unlinked | CRITICAL |
| `api_key` | key **created** | CRITICAL |
| `api_key` | key **expiring** | NORMAL |
| `commerce_fulfillment`, `commerce_return` | shipping / RMA status | NORMAL, TRANSACTIONAL |
| `commerce_wishlist` | price drop / back in stock | NORMAL, MARKETING |
| `observability` | status-page subscriber mail | NORMAL |
| `tenant` | workspace being permanently deleted | CRITICAL |
| `tenant_member` | your role / status changed | NORMAL |
| `tenant_invitation` | reminder, accepted / declined / expired | NORMAL |
| `tenant_domain` | DNS verification failed, SSL expiring | NORMAL |
| `tenant_export` | your export is ready | NORMAL |

**CRITICAL is not a synonym for important.** It skips every
recipient-controlled gate, so it belongs to notices a preference must never be
able to silence: you are locked out, a credential was minted, somebody is
acting as you, an identity provider was attached to your account. An API key
approaching *expiry* is an operational reminder and stays NORMAL — marking
everything CRITICAL would make the flag mean nothing.

Several migrations also collapsed a **double send**: `auth_passkey` and
`auth_impersonation` each pushed in-app *and* mailed by hand; `support` did the
same to a ticket requester, and `approval` to a submitter on a terminal
decision. Now that one dispatcher call fans out to every installed channel,
keeping the direct in-app push would post the notice to the inbox twice.

The line to hold when collapsing them is **who the recipient is**. `support`
still pushes in-app to the assigned AGENT by hand, because that push has no mail
counterpart to merge — routing it through the dispatcher would start emailing
agents about traffic they only ever saw in-app. Same in `approval`: an
*escalation* keeps its direct push, only the terminal decision was merged.

The workspace-deletion warning is the strongest CRITICAL case in the sweep: the
owner's data is about to be destroyed irreversibly, and a muted preference must
not be why they missed the last chance to stop it. Everything else in the tenant
group is NORMAL — a failed DNS check or an expiring certificate wants attention,
but the admin has a screen showing the same state.

Migrated since: `approval` (terminal decision), `drive` (share), `gift_card`
(delivery CRITICAL — the raw code exists only at that moment and is never
persisted, so a silenced notice destroys the thing bought; expiry reminder
NORMAL), `support` (requester notices), `form_builder` (submission notice to the
`formBuilderNotifyEmail` address), `auth` + `auth_saml` (below).

### The auth mails, and the one distinction worth copying

| notice | urgency | channels |
|---|---|---|
| OTP code | CRITICAL | **mail only** |
| password-reset link | CRITICAL | **mail only** |
| password was reset | CRITICAL | all |
| two-factor enabled / disabled | CRITICAL | all |
| welcome (`auth_saml` JIT) | NORMAL | all |

All of them are CRITICAL for the obvious reason — an auth mail a preference can
silence is a preference that can lock you out — but the two that **carry a
credential** are also restricted with `channels: ['mail']`. The dispatcher's
default is to fan out, and fanning out a live OTP or reset link would drop it
into an in-app inbox reachable from the session the user has just lost, on top
of widening the blast radius of the credential itself. The notices that carry no
credential do the opposite and go everywhere: their job is to reach somebody
whose account may be being taken from them.

`auth`'s OTP **SMS** branch still calls `notification_sms` directly. It is a
deliberate channel choice by the user rather than a bypass of policy, and the
audit finding was about mail; unifying it is a separate slice.

`otp_enabled.ejs` / `otp_disabled.ejs` had **no caller at all** until this
migration — the second dead-template finding of the sweep. They are now wired to
the OTP verify route, under the ROOT tenant, because `otpMethods` lives on
`UserSecurity` and is an account fact, not a workspace one.

### Billing — the last four, and one recipient rule worth keeping

| module | notice | recipient | urgency |
|---|---|---|---|
| `invoice` | issued / receipt | the invoice's `customerEmail`, **address only** | NORMAL |
| `tenant_subscription` | dunning (charge failed) | our own tenant admins, **with `userId`** | NORMAL |
| `payment_subscription` | trial ending, renewal approaching | the subscriber, **with `userId`** | NORMAL |
| `hr_payroll` | payslip issued | the employee's WORK email, **address only** | NORMAL |

The split is not an oversight. A `userId` is passed wherever the recipient is a
person with an account, because that is what makes preferences and the in-app
inbox work. It is deliberately NOT passed where the address belongs to a role
rather than a person: an invoice goes to `accounts@…`, and a payslip goes to the
work address precisely because most employee records have no platform login at
all (`Employee.userId` is nullable and usually null). Guessing a member behind
those addresses would attach one person's notification preferences to their
company's billing mail.

All NORMAL. None of these is an account-control notice, and each has a screen
that shows the same state — a muted recipient loses a copy, not the document or
the fact.

**The sweep is complete**: every module the audit listed either dispatches now,
or is recorded above with the reason it does not (`contact`, `mail_inbound`, the
contact-form pair's `replyTo` gap, and `auth`'s OTP-by-SMS channel choice).

### Two modules that look like bypasses and are not

`contact`'s outbound gate (`contact.outbound.service`) and `mail_inbound` were
both on the original list. Neither belongs there:

- **`contact` sends mail as the USER, not as the platform.** A sales email to a
  prospect is the product doing its job, not a notification about it, and the
  recipient is a stranger with no account and no preferences to consult — which
  is why it gates on `SuppressionService` (unsubscribes, purpose) instead. It
  also needs things the dispatcher cannot express: `sendMailDirect` for a
  synchronous success/failure verdict, and a full RFC header set (`Message-ID`,
  `X-Loop`, `In-Reply-To`/`References`, `List-Unsubscribe` + `-Post`) that
  carries threading and one-click unsubscribe. Routing it through the dispatcher
  would break reply matching and the unsubscribe button.
- **`mail_inbound` never sends.** It imports `notification_mail.provider.service`
  only to read the configured From address. Reading configuration is not a
  delivery bypass.

### The account-security templates had no callers at all

Opening `notification_mail.account-templates.service` to migrate it turned up
something better than a refactor: **four of its eight methods were dead.**
`email_change`, `password_changed`, `suspicious_activity` and `new_device_alert`
each had a template, rendered correctly, and were called by nothing — so the
product promised alerts it never sent. The login-anomaly path told the tenant's
*webhook integrations* that someone signed in from a new device and left the
account owner to find out on their own; a password change wrote an audit row
that notifies nobody.

Two of the four are now wired to their real triggers, CRITICAL, through the
dispatcher:

| trigger | notice |
|---|---|
| a sign-in (the login routes, 38-security 3.6, `auth.login-alert.ts`) | new-sign-in alert with device, address and place (the copy in `recordLoginAttempt` was removed with the second anomaly detector, phase 55 00.4) |
| `pushPasswordHistory` | password-changed alert, sent under the ROOT tenant |

A password is an **account** fact, not a workspace one — sending it under the
root tenant means a user in three workspaces is told once, by the platform,
rather than three times.

`email_change` and `suspicious_activity` stay unwired: neither has an obvious
trigger in the tree today (there is no email-change service path, and
"suspicious activity" has no definition beyond the anomaly the new-device alert
already covers). Inventing one would be a feature, not a migration.

The four became `render*` methods returning `{ subject, html }` — the **domain**
decides to send, because `notification_mail` is a channel *behind* the
dispatcher and a channel reaching around its own dispatcher is the PLAT-01 shape
inverted.

The two with live callers followed:

| render | sender | urgency |
|---|---|---|
| `renderVerifyEmail` | `auth.verification.service` | CRITICAL — an unverified account is blocked until it arrives, so no preference may silence it |
| `renderTenantInvitation` | `tenant_invitation.notify.sendInvitationEmail` (both the create and resend routes) | NORMAL — ordinary workspace traffic |

**Still queueing directly**: `sendContactFormAdminEmail` / `sendContactFormUserEmail`.
Not an oversight — the admin copy needs a `replyTo` header pointing at the
visitor (its template promises the operator can "reply directly"), and the
dispatcher carries no per-message envelope override: the mail channel reads
`data.html` and nothing else. Migrating that send today would silently drop the
header. Both also have **zero production callers** — the contact form sends no
mail at all — so the order of work is: give the mail channel an envelope
override, then migrate. Until then this is a capability gap, not a live bypass.

## Recipients without an account

`NotificationRecipient.userId` is **optional**. It is still the preferred
handle and the one that makes preference resolution possible, but some people
the product must write to have no account at all: a guest checkout has an
order, a parcel and a legal obligation to be told where it is.

The trade is explicit rather than hidden. An address-only recipient has **no
preference layer** — there are no preferences to read, so `decide()` skips the
lookup instead of failing it — which means the consent question is the
caller's. For commerce that is `contact.SuppressionService`, which gates on the
ADDRESS (bounce, complaint, opt-out) and therefore works for guests; the
composition of the two gates lives in `contact.dispatch.ts`. Marketing to an
address-only recipient without that gate is not made lawful by this schema.

Account-bound channels declare `canDeliver` accordingly: in-app has no feed to
write to and push has no subscription, so both require `userId` and the
dispatcher records `no_address` rather than reporting a delivery it could not
make.

This came in as commerce plan 09 §3.4's written request — the alternative was
commerce reaching past the dispatcher into the mail queue, which is the exact
shape this module exists to end.

## Channels are contributions, not imports

`notification` never imports a channel module. Channels register through the
`notification:channel` extension point:

```ts
const provider: NotificationChannelProvider = {
  channel: 'mail',
  canDeliver: (input) => Boolean(input.recipient.email),
  async deliver(input) { /* render + send */ },
}
export default provider
```

That is what keeps the dispatcher installable with zero channels, and lets a
tenant have only the channels it paid for.

> **A provider must not re-check preferences, opt-outs or quiet hours.** Policy
> was already resolved once, up front, for every channel at the same time. This
> is why the in-app contribution calls `pushRaw` rather than `push` — `push`
> re-runs its own checks *and* fans out to web push, which under the dispatcher
> would apply the policy twice and deliver the push twice.

| Channel | Contributed by | Notes |
|---|---|---|
| `inapp` | `notification_inapp` | `pushRaw` — store + broadcast only |
| `mail` | `notification_mail` | `event.data.html` for a rendered template; `event.attachments` (files, inline images) |
| `push` | `notification_push` | quiet hours NOT re-applied here |
| `sms` | `notification_sms` | most expensive/intrusive; quiet hours defer it |
| `telegram`, `slack`, `discord`, `whatsapp` | `notification_external` | open-set channels: `EXTERNAL` address (linked account), toggle in `channelPrefs.<id>`; the platform itself is a sandboxed `@chat/*` marketplace plugin |

## Failure behaviour

Best-effort by design. A channel provider that throws, or that is installed but
fails to load, is logged, counted in `failed`, and the other channels still go
out; a channel whose module is not active for the tenant is simply not delivered
(not a failure); `notify` never rethrows. A notification is a side effect
of a domain action, and failing the domain write because a push provider is down
would be the wrong trade. Unreadable preferences **fail open** (deliver) — the
opposite would let a Redis blip silence the platform.

## Scope note

Migrated to the dispatcher so far: `messaging` offline push, `auth.new_login`.

**The remaining sweep, measured 2026-08-02.** The audit estimated "~22 direct
`MailService` callers". The real count outside `notification_mail` itself is
**six files**, and they are not one homogeneous backlog:

| Caller | What it sends | Why it is still direct |
|---|---|---|
| `auth/auth-login.route.ts` | new-login notice | **Already on the dispatcher** — it renders HTML and calls `notify`. Counted as a violation by mistake. |
| `auth/auth.otp.service.ts` | OTP code | Security credential. Belongs on `notifyCritical`, which exempts it from every recipient-controlled gate — the conversion buys the ledger and the `explain()` trail, and must not change delivery. |
| `auth/auth.password.service.ts` | forgot-password, reset-success | Account recovery. Same class as OTP. |
| `auth_saml/saml-callback.route.ts` | JIT-provisioning welcome | Informational — the one genuinely gate-able case. |
| `invoice/invoice.transition.service.ts` | invoice issued / paid | **Structurally out of scope.** It addresses `invoice.customerEmail` — a customer contact, usually not a platform user — and `NotificationRecipient` requires a `userId`, because addressing by bare email is precisely why preferences could not be consulted. An invoice is also a document you are obliged to deliver, so gating it would be wrong even if the recipient were resolvable. |
| `tenant_subscription/…billing-notifications.ts` | past-due dunning | Needs a recipient resolver for "the active ADMINs of a tenant", which no domain owns yet. |

So the sweep is smaller than stated and mostly **CRITICAL-class**: the four auth
conversions do not change who receives what, they put security mail on one
policy path so "why didn't I get that?" has an answer. Each needs a
`renderXEmail` split out of the corresponding `sendXEmail` in
`notification_mail` — today only `renderNewLoginEmail` exists — which is a
per-template refactor on the login path and deserves its own pass rather than
being folded into an unrelated one.

Template ownership (`invoice_*.ejs` moving out of `notification_mail` into the
domains that own them) is likewise not part of this module yet.

## Dependencies

`logger`, `tenant_setting`, `user_preferences`. No channel module — by design.


## Open channel set and the CRITICAL switch (docs/phases/30-notification/01)

- A channel id is an open slug (`^[a-z][a-z0-9_]{1,31}$`); `listChannels(ctx)` (`notification.channels`) is the four
  core channels plus every `notification:channel` contribution the context may use (a tenant context: modules active
  for that tenant; a system context: the whole build). A new channel declares `metadata`
  `{ label, addressKind, respectsQuietHours }` in its `module.json`; a contribution without `respectsQuietHours` is
  ignored with a warning. The core four keep their columns, address kinds and quiet-hours behaviour unchanged.
- A channel without a `user_preferences` column reads `channelPrefs[channel]` (`false` = off; absent = allowed).
- **OD-10:** a `CRITICAL` notification bypasses the recipient's toggles, category opt-outs and quiet hours by default.
  The tenant setting `notificationCriticalBypassesPreferences` (`'false'` turns it off, default on) makes `CRITICAL`
  gated like `NORMAL`. `notifyCritical` (account security: OTP, reset, new-device) sets `accountSecurity` and is never
  affected by the switch. Providers never see the setting.
