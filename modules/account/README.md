# account

**The signed-in person's own account surface.** One API prefix — `/api/auth/me/*`
— and one page, `/admin/me`. Zero tables.

## Why this module exists

`auth` answers "who is this and may they in?". That is a bounded question, and
`auth` is very good at it. What it had also accumulated was every *account*
screen: read my profile, change my preferences, list my sessions, revoke one,
see my notifications, list the tenants I belong to, see what device I am on.

None of those are authentication. Each one made `auth` import another module, so
the module every request already touches carried a fan-out to `user_profile`,
`user_preferences`, `user_security`, `user_session`, `user_social_account`,
`notification_inapp` and four tenancy modules — none of which logging in needs.
That is what the 2026-08 audit called the `auth` god-module (MIS-01).

The other half of the same problem was on the UI side: `/admin/me` lived in
`user`, and it composes the passkey and signing-certificate panels. `user` has
23 consumers, and every one of them was transitively dragging the whole
auth-method stack behind a page they never render.

Both now live here. `auth` shrank to authentication; `user` shrank to the user
directory; a tenant that has no passkeys and no e-signature no longer pays for
either through the back door.

## What is here — and what deliberately is not

| Here | Not here |
|---|---|
| `/api/auth/me/profile · preferences · security · sessions · trusted-devices · notifications · social-accounts · tenants · device-info` | Login, logout, refresh, register, password reset — `auth` |
| The `/admin/me` page that composes them | The panels themselves — each satellite owns its own (`auth_passkey`, `auth_e_signature`, `user_session`, `user`) |
| The `account.*` permissions those routes enforce | `auth.me.otp.*` / `auth.me.totp.*` / `auth.me.email.verify` — those gate authentication METHODS, and stayed with `auth` |

The API paths are unchanged. `/api/auth/me/*` is what every client already
calls, and a module boundary is not a reason to break them; only the handler
moved. The `account.*` permission ids ARE new (they were `auth.me.*`), which is
safe by construction: an unknown permission falls through to the role floor
rather than locking anyone out, and every one of these is floored at `USER`.

## Composition, not ownership

This module owns no entity and no service. Every route is a thin adapter:
authorise, delegate to the satellite that owns the data, return. That is the
whole design — a gateway that gives the account surface ONE place to live
without giving it a second copy of anyone's data.

The corollary: a new self-service surface belongs here only if it is genuinely
*about the account*. If it is about a feature, it belongs to that feature, and
this module should not grow a tab for it.

## Protected

`account` is in the PROTECTED set. It holds no product feature to sell or
disable, and turning it off would take away someone's ability to read their own
profile or revoke their own session — which is not a packaging decision.
