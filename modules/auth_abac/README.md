# auth_abac — Attribute-Based Access Control

Runtime, per-tenant **ABAC** on top of the existing RBAC. A policy decision point
(PDP) evaluates `subject × action × resource × environment` attributes into a
`permit`/`deny`, and a policy enforcement point (PEP) — the `authorize()` guard —
lets route handlers enforce that decision in one line, next to the existing
`authenticateTenantByRequest` call.

## Model

- **Decision:** `evaluate(subject, action, resource, environment) → { effect, policyId?, reason }`. Default = **deny** (fail-closed).
- **Combining:** `deny-overrides` — the first matching `deny` wins; else the first matching `permit`; else RBAC fallback; else default-deny.
- **RBAC fallback:** when no policy applies, the existing `requiredTenantRole` / `PERMISSION_MATRIX` decision stands. ABAC is **additive** — it can further restrict, never loosen.
- **Enforcement is opt-in:** only routes that call `authorize()` are covered (see `POSTURE.md`).

## Layout

| Layer | File |
|-------|------|
| Policy model / DTO / types | `server/auth_abac.types.ts`, `auth_abac.dto.ts`, `auth_abac.enums.ts` |
| Entity + cache | `server/entities/auth_abac_policy.entity.ts`, `auth_abac.decision.cache.ts` |
| Policy CRUD + read-through cache | `server/auth_abac.policy.service.ts` |
| Pure decision engine | `server/auth_abac.eval.ts` (`evaluatePolicies`, `explain`, `ruleMatches`) |
| PDP (cache + fallback + audit) | `server/auth_abac.pdp.service.ts` |
| PEP guard + attribute sources (PIP) | `server/auth_abac.guard.next.ts`, `auth_abac.attributes.ts` |
| Admin API | `server/auth_abac-policies*.route.ts`, `auth_abac-simulate.route.ts`, `auth_abac-decisions.route.ts` |
| Admin UI | `ui/policies.page.tsx`, `ui/policy-detail.page.tsx`, `ui/rules-editor.component.tsx`, `ui/simulator.page.tsx` |

## Custom groups and the role floor

A permission's `minRole` is the coarse floor on the member's built-in role. A custom group (`tenant_roles`, assigned through
`roleKeys`) can lift a permission over an **ADMIN** floor for a real member, never over an OWNER floor, and only on routes
that take their floor from the catalog (a route that names its own `requiredTenantRole` stays strict). The TENANT path
authenticates at USER, then needs the built-in role or a group grant of that exact permission; otherwise it authenticates
again at the real floor and throws the ordinary 403. `grantedPermissions` (the menu) applies the same rule. See
`server/auth_abac.guard.group-floor.next.ts` and `tenant_member/README.md` ("Custom role groups").

## The installation's config/access.ts (docs/phases/45-install-config D45-4)

Per install role (`sysadmin`, `owner`, `admin`, `user`, custom groups by key; `common/server/install-config`), an
installation removes or grants permission ids. `installVerdictOf` (`server/auth_abac.install-verdict.ts`) works the
viewer's verdict out once, and three places read it: the PDP (`EvaluateOptions.install`: a removed id is denied with the
reason `install_config` before any policy is read; a granted id is permitted where no policy applied, over the role
matrix, while an explicit policy deny still refuses it), the role floor (a grant lifts an ADMIN floor exactly as a custom
group does, never an OWNER floor) and `grantedPermissions` (the menu and the admin page guard). `decisionBlocks` makes an
`install_config` deny block in shadow mode too: nothing editable in the UI loosens the installation's config. The
decision is audited as `enforced: true`. `announceInstallAccess` (`server/auth_abac.install-access.ts`, called by
`instrumentation.ts`) lists every removal and grant once at boot and writes the grants to the audit log
(`install_config.access.grants`).

- A platform admin acting in a tenant is `sysadmin` by the session's `isGlobalAdmin` or by the virtual member they act
  through (tenant_session `isGlobalAdminMember`), so a route that builds its own `{ user, tenantMember }` session for an
  inline check cannot make them the tenant's `owner`.
- `VisibilityService` reads a removal of a `*_read_all` twin: the role gets no ALL scope. A grant of one does not widen a
  scope (ALL comes from the role matrix alone, as for a custom group).
- An account permission (module.json `"scope": "account"`) is checked only by ACCOUNT-scope routes, in the root tenant
  without a membership, so the caller is `user` or `sysadmin` by their platform role. config/access.ts may name it only
  under those two roles (`parseInstallAccess` refuses the rest), and the admin page guard decides it the same way.
  `scripts/registry/tests/account-permissions.security.test.ts` keeps the flag and the routes in step.

## Using the guard (opt-in, from any module route)

```ts
// after identity + coarse-role auth …
await TenantSessionNextService.authenticateTenantByRequest({ request, tenantId, requiredTenantRole: 'ADMIN' });

// … enforce a fine-grained ABAC decision
const page = await DynamicPageService.get(tenantId, pageId);
await authorize({
  request, tenantId,
  session,                       // { user, tenantMember } from the auth result
  action: 'dynamic_page.page.update',
  resource: buildResource('page', page),   // only allow-listed fields (ownerId/status/…)
});
```

`can({...})` is the non-throwing variant for UI/conditional branches.

## How the caller signed in: `subject.amr` and `subject.acr` (FID-08)

A policy can demand a stronger login method (12-fleet-identity.md section 5). Both attributes come from the
caller's own user session, never from the request:

| attribute | what it is | where it comes from |
|---|---|---|
| `subject.amr` | the authentication methods (RFC 8176): `pwd`, `otp`, `mfa`, `hwk`, `fed:<provider>`, `fed:org:<id>` | `user_sessions.metadata.amr`, recorded by the login path; on a node the Fleet ID login copies the ID token's `amr` |
| `subject.acr` | the assurance level derived from it, weakest first: `NONE`, `LOW` (password or federated alone), `SUBSTANTIAL` (a verified second factor), `HIGH` (a passkey) | `acrOf(amr)`; for recorded methods the same ladder the hub's consent ledger records (with nothing recorded the ledger writes `loa LOW`, a node says `NONE`) |

**Write a requirement as a `deny` policy, never as a `permit`.** A permit that does not match does not refuse anything: the policy
set returns `not_applicable` and the PDP falls back to the role matrix, which permits a granted (or unseeded) permission. So "permit a
payout only when `subject.amr contains 'mfa'`" still pays out to a password-only session. And an absent attribute reads as the empty
string, which satisfies `neq` and `nin`, so a permit such as `subject.acr nin ['NONE', 'LOW']` would grant to a subject with no `acr`
at all. The safe forms deny below the bar:

- deny `fleet.breakglass.approve` when `subject.acr nin ['HIGH']`;
- deny `finance.payout.create` when `subject.acr nin ['SUBSTANTIAL', 'HIGH']` (a verified second factor or a passkey).

Under deny-overrides such a deny holds whatever permits or role grants say, and it holds for an absent value too (`nin` is true for the
empty string), so a caller whose session could not be read is refused.

**What each login path records.** Password `pwd` (web, native device login and the merge-identity re-login), passkey `hwk`, social
`fed:<provider>`, SAML `fed:saml`, national ID `fed:<provider>` (e.g. `fed:tr_edevlet`), e-signature `fed:e-signature`, and a
verified second factor adds `otp` and `mfa`; a Fleet ID login on a node copies the ID token's `amr`, and a tenant switch
(`/auth/session/exchange`) carries the source session's `amr` over. A magic link records nothing (RFC 8176 has no e-mail link method),
nor does a break-glass session or a session minted before methods were recorded: those are `acr NONE`, which every
`deny when acr nin [...]` refuses. Values outside the vocabulary are dropped, never trusted. Both attributes are absent for an anonymous
caller and when the session cannot be read.

The guards pass the session they already authenticated; a route that passes only `{ user, tenantMember }` gets the request's own session
read lazily, and only when a policy of the tenant names one of the two attributes. Attribute providers cannot contribute either key, and
the decision cache keys on them, so a permit cached for a passkey session never answers a password session of the same person.

## Custom roles are DATA, not a second engine (phase 6.3)

A tenant's own role groups reach policies as two subject attributes, and the
evaluator did not change to accept them — `contains` / `in` already handle a
string array, which is the whole point of roles being data.

| attribute | what it is | where it comes from |
|---|---|---|
| `subject.role` | the primary built-in role — unchanged | `tenant_members.memberRole` |
| `subject.roles` | that role **plus** the custom group keys held | `memberRole` + `roleKeys` |
| `subject.permissions` | the union of those groups' permission sets | `TenantRoleService.permissionsFor` |

So a policy can now say `subject.roles contains 'content.editor'` or
`subject.permissions contains 'dynamic_page.page.update'`.

`roles` is **always** present, including for an anonymous caller (`['GUEST']`).
Emitting it only for members who hold a group would make a policy behave
differently for two people whose only difference is having one — the kind of
silent inconsistency that makes an authorization system untrustworthy.

`permissions` is built by an **async enricher in the PDP adapter**, not by
`resolveSubjectAttributes`, which stays synchronous and pure (it is the piece
that is exhaustively unit tested) — and not by the PDP core, which must not
know where a permission set comes from. A member with no groups pays nothing:
the common case short-circuits before any lookup. A lookup failure leaves the
attribute **absent** rather than empty — absent is not-applicable to a policy,
while `[]` would read as "this person has no permissions at all" and could flip
a rule from silent to denying.

In the RBAC fallback a custom group **grants outright**: assigning somebody a
group IS the grant, so it permits even where the built-in matrix says no. The
reverse never happens — a group cannot take a permission away.

## Coverage inventory — what is actually wrapped

`auth_abac.coverage.ts` answers "which routes reach the PEP", and its whole
purpose is to stop the "the policy engine is installed, so we're covered"
illusion. A route that is not in it is governed solely by its coarse role floor.

**It is generated, and that is a fix.** It used to be hand-written and had 49
entries against 900+ guarded routes — almost all `dynamic_page`. The one
artefact whose job was an honest answer was giving a false one, in the dangerous
direction: somebody looking up a covered route found nothing and would
reasonably conclude it was bare. A list that must be updated by hand on every
new route is a list that will be wrong.

```
npm run abac:coverage          # regenerate after adding or re-guarding a route
node scripts/registry/abac-coverage.mjs --check   # what the test runs
```

A route counts as guarded when it calls `authorizeRequest` itself **or** through
a local helper it imports (`dashboard.route.helpers` is the live example).
Ignoring that indirection would report 17 false gaps — the same illusion running
the other way.

### The gap list is the valuable half

`UNGUARDED_ROUTES` records **why** each of the 66 unguarded routes has no policy
layer, in five categories: `IDENTITY_FLOW` (no subject exists yet — that is the
point), `CRON_SECRET`, `PUBLIC`, `MACHINE_AUTH` (API key, bearer, signature) and
`PROVIDER_CALLBACK`. Every one of them is "there is no authenticated tenant
member to reason about"; each still has its own guard, named in the note.

The test refuses an entry with no reason **and** a reason with no entry — so a
new bare route cannot join the list quietly, and a stale exemption (which reads
as a considered decision about something that no longer exists) cannot sit there
either.

## A policy change holds at once on every node (D253)

`abac_policies:<tenant>` (the active set), `tenant_roles:<tenant>` (tenant_member's role set) and `abac_decision:<tenant>:<hash>` (the
opt-in decision cache, `cache: true`) are guarded caches (session_end.cache-guard.ts):

- every policy write (`create`, `update`, `remove`) runs in a transaction that records a cache drop through `session_end`: the set deleted
  and `abac_policies:ver:<tenant>` bumped; every role-set write (matrix save, group create / update / delete) does the same for
  `tenant_roles:ver:<tenant>`. Delivered after the commit, else by the session_end relay from any node; a write whose drop cannot be
  recorded rolls back;
- an entry is believed only when sealed with the stamp of this read (the Redis instance id from `redis.health.ts`, withheld during and
  for 5 s after any Redis trouble, and the versions read with it in one round trip) and no drop is pending for the tenant; otherwise the
  database answers. A cached decision carries BOTH versions, so a DENY added, a PERMIT removed or a permission taken from a role retires
  every cached decision of the tenant at once (before D253 the decision cache was not flushed by a policy write at all);
- the decision key also carries the subject's role and resolved permissions (a group taken away is another key).

No process-local copy of a policy set, role set or decision exists (the request memo lives for one request). Lane:
`auth_abac.redis-outage.test.ts` (scratch `redis-server`, two nodes, `SECURITY_TEST_LIVE=1`).

**The runtime settings (D270).** Shadow mode, the decision-log mode, the regex budget and the sample rate are one guarded entry
`abac_settings:<tenant>` (`auth_abac.settings.service.ts`), sealed with the Redis instance and the settings generations of ROOT and the
tenant (`settings:<tenant>:gen`, bumped by the cache drop every setting write records in its transaction, tenant_setting) and believed
only with no drop pending for the tenant or ROOT. The refill reads the database (`SettingService.getByKeys(..., { fromDatabase: true })`),
never the plain settings map, and is not cached when a read failed (the fail-safe defaults must not outlive a settings outage). Turning
shadow mode off on ROOT therefore enforces on every node at its next decision, also through a Redis outage. Lane:
`auth_abac.settings.redis-outage.test.ts`.

## Reuse (not rebuild)

Operator engine follows `feature_flags.eval` + `auth_saml` rule matching; the
read-through cache follows `feature_flags.service`; decisions are logged to the
shared `audit_log` (`action: 'abac.decision'`) — no new log table.

Phase plan: [`docs/phases/11-auth-abac/`](../../docs/phases/11-auth-abac/) · overview: [`docs/phases/11-auth-abac/00-plan.md`](../../docs/phases/11-auth-abac/00-plan.md) · security stance: [`POSTURE.md`](POSTURE.md).

## The caller note (phase 55 02 §2.1)

Phase 55 02 §2.1 (D55-25): once `authorizeRequest` lets a caller through it notes who it was beside the request
(`noteRequestPrincipal` in `common/server/request-observer.ts`: user, session, API key, member role, tenant; ids only, never a token), which
the AI firewall's feature store reads from the dispatcher's observation. A refused caller is not noted; the note never changes an
authorization.
