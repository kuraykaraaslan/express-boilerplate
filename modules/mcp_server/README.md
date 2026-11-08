# MCP server (`mcp_server`)

Core module. The platform's MCP (Model Context Protocol) host: a person connects an MCP client (Claude Code, Claude Desktop, Cursor,
VS Code; hosted connectors with OAuth in 57.3) to their workspace, and the model reads the records that person may read, with that
person's rights and nothing more. Design: [docs/phases/57-mcp-server](../../docs/phases/57-mcp-server/README.md),
[ADR-0022](../../docs/adr/0022-the-platform-serves-mcp-per-module-on-sdk-v2-with-oauth-and-mcp-scoped-keys.md).

Edition `core`, tier `platform`, placement `core`. It owns no domain tools: modules register theirs.

## Registering tools from a module

Any module offers MCP tools on its own server (`/api/mcp/<moduleId>`) in two steps, from its own folder. It imports only the contract
from `common`, never this module and never the MCP SDK.

1. `server/<module>.mcp-tools.ts` default-exports one tool or an array (named first: the lint refuses an anonymous default export):

```ts
import { z } from 'zod';
import { defineMcpTool, mcpFail, mcpOk } from '@kuraykaraaslan-labs/common/server/common.mcp-contracts';

const WIDGET_TOOLS = [
  defineMcpTool({
    name: 'list_widgets',                       // {verb}_{noun}, an approved verb, at most 48 characters
    title: 'List widgets',
    description: 'Lists widgets the person may see. Precondition: none. Output: up to 50 widgets. Errors: none.',
    kind: 'read',                               // or 'write': create_* (idempotency 'key') and update_* (idempotency 'version') only
    permission: 'widgets.widgets.read',         // YOUR module's permission, exactly as your routes check it
    input: z.object({ limit: z.number().int().min(1).max(50).default(20) }),
    output: z.object({ widgets: z.array(z.object({ widgetId: z.string(), name: z.string() })) }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run({ caller }, input) {
      // caller.tenantId, caller.userId (the person the credential acts as): apply the same record visibility your routes apply
      const widgets = await WidgetService.list(caller.tenantId, caller.userId, input.limit);
      return mcpOk(`${widgets.length} widget(s).`, { widgets }, [{ source: 'widgets/list', text: widgets.map((w) => w.name).join('\n') }]);
    },
  }),
];

export default WIDGET_TOOLS;
```

2. `module.json` → `extensions`:

```json
{ "point": "mcp_server:tool", "key": "mcp_tools", "export": "<module>/server/<module>.mcp-tools", "scope": "system",
  "description": "…", "metadata": { "label": "<module>: …", "ids": ["list_widgets"] } }
```

and the file in `package.json` `exports`; then `npm run registry:snapshot`. The reference contributor is `tasks`
(`modules/tasks/server/tasks.mcp-tools.ts`: `list_tasks`, `get_task`).

**What a tool never does**, because the host does it (gates S3, F6, F18): authenticate, check the permission, rate limit, audit, time
out, cap the result, build the error envelope or the content blocks, or fence foreign text. `run` gets the verified caller, validated
input and an abort signal. It must apply the module's own **record visibility** (a list filtered to what the person may see, a record
they may not see answered `mcpFail('NOT_FOUND', …)`), exactly as the module's GET routes do.

**Foreign text** (anything a person typed: titles, descriptions, comments, file names) goes in `foreign`, never in `summary`: the host
puts the summary first and each foreign text in its own fenced block labelled as data (tool-definition-and-output.md §4.4).

**The boot guard `mcp-tools`** refuses the boot on: a malformed name, a coined synonym or generic verb, a description without
`Precondition:`, `Output:`, `Errors:` or over 600 characters, wrong annotations for the kind, a schema that is not a Zod object, a keyed
verb (`create`, `upload`, `send`, `publish`) without `idempotency: 'key'` and an `idempotencyKey` argument, a permission that is not the
contributor's own or that no API key may hold (phase 48 D48-3), a read permission on a write tool, a duplicate name, manifest `ids` that
differ from the export, a write verb other than create / update (D57-21), a create without an idempotency key or an update without
a version guard, and a contribution that cannot be loaded.

**Write tools** (57.6): the host runs a create once per `idempotencyKey` (per credential; a repeat answers the first result) and the
tool checks `expectedVersion` on an update (a changed record is CONFLICT). An OAuth app needs the `mcp:write` scope, which a person
grants only right after signing in.

## The endpoint

| | |
|---|---|
| Transport | Streamable HTTP, `POST /tenant/<tenantId>/api/mcp/<moduleId>`, JSON-RPC 2.0, stateless (a server per request), JSON answers only, no `Mcp-Session-Id`, GET and DELETE 405 (the dispatcher) |
| Revisions | Built against **`2025-11-25`** (`BUILD_TARGET_REVISION`, `server/mcp_server.protocol.ts`; the drift test fails the build when the SDK moves). The current spec revision is `2026-07-28`: those requests are served by `createMcpHandler` (`legacy: 'reject'`); 2025-era requests by a stateless JSON transport (`isLegacyRequest`) |
| SDK | `@modelcontextprotocol/server` 2.4.0 (exact), Zod 4; `inputRequired.legacyShim: false`, every cache hint private |
| Auth | An **OAuth 2.1 access token** of the workspace's own authorization server (hosted connectors; below), or an **API key** of the tenant, made on the API keys page, holding `mcp_server.connect` (USER floor) plus the permissions of the tools it should reach. The tenant guard's key lane verifies it (active, unexpired, its tenant ACTIVE, its holder an ACTIVE member, IP lists, its rate limit, the URL tenant) and acts as its holder; a tool runs only while the key AND its holder hold the tool's permission. A cookie session is refused 401 |
| Order | method, Origin (own host only; none passes), declared size → the tenant guard → content type → the module's server (404 when it has no tools or is off for the tenant) → the caller's tools → bounded body → dispatch |
| Limits | body 64 KiB; result 256 KiB (larger is refused: ask for fewer rows); foreign text 32 KiB per block; 10 s per call; 120 read and 20 write calls per minute per credential (fail closed) |
| Audit / firewall | one audit row per call, `mcp_server.tool.called` or `mcp_server.tool.refused` (tool, outcome, duration, argument names; never values or results), actor the key: the AI firewall's signals of the same names (lane `machine-apikey`); a key misbehaving is acted on through `api_key.throttle` / `api_key.revoke` |

## OAuth 2.1 (hosted connectors)

The workspace runs its own authorization server for its MCP servers only (no proxy, tokens never forwarded). A client starts from a
401's `WWW-Authenticate: Bearer resource_metadata="…/api/mcp/oauth/protected-resource/<server>"`, reads the authorization server metadata
(`…/api/mcp/oauth/.well-known/oauth-authorization-server`, also `openid-configuration`), and sends the person to the consent screen
`/admin/mcp/authorize` (they sign in first if needed and must hold `mcp_server.connect`).

- Clients: `client_id` is the https URL of a Client ID Metadata Document; its host must be a known one (Claude, ChatGPT, Cursor, VS Code,
  GitHub and their subdomains) or listed in Settings → MCP → More AI apps; the document is fetched through `safeFetch` (public address
  pinned, no redirects, 3 s, 8 KiB). No dynamic client registration.
- Flow: code + PKCE S256 only, exact redirect match, `resource` (RFC 8707: the workspace's `/api/mcp` or one server), scope `mcp:read`,
  `iss` in the response (RFC 9207). Code 60 s, taken once. Access token opaque, 10 minutes, in Redis as a SHA-256; refresh token opaque,
  rotated on every use, a reused one revokes the grant (`mcp_server.grant.refresh_reused`, high). Grant lifetime 90 days.
- Every MCP call reads the grant (revoked or suspended stops at once, everywhere); the token must cover the server called.
- The person's **Connected apps** page (`/admin/mcp/connected-apps`, menu Developer) lists and disconnects their apps; an admin
  (`mcp_server.settings.manage`) sees everyone's. The AI firewall may suspend a grant (`mcp_server.suspend_grant`, undo resumes).
- An OAuth call's audit row has no actor and names the grant, so the firewall weighs it against the grant on lane `machine-mcp`.

## Settings and the index

**Settings → MCP** (`/admin/settings/mcp`, permission `mcp_server.settings.manage`, ADMIN): `mcpEnabled` (off by default; while it is off
every MCP call is 403 and the index is empty; a failed settings read counts as off) and `mcpDisabledTools` (`<server>/<tool>` per line:
not listed, not callable, whatever the credential holds).

**`GET /tenant/<tenantId>/api/mcp`** (an API key or a session holding `mcp_server.connect`): `{ enabled, servers: [{ server, path, tools:
[{ name, title, kind }] }] }`, only what the caller can use: modules enabled for the tenant, tools not switched off, permissions held.

## Tools today

| Server | Tool | Permission | What |
|---|---|---|---|
| `tasks` | `list_tasks` | `tasks.tasks.read` | The person's visible tasks, filtered (mine, open, status, title words), paged, up to 50 |
| `tasks` | `get_task` | `tasks.tasks.read` | One task with its description; not found when the person may not see it |
| `tasks` | `create_task` | `tasks.tasks.create` | A task owned by the caller, optionally assigned to them; run once per `idempotencyKey` |
| `tasks` | `update_task` | `tasks.tasks.update` | Title, description, priority, due date of a task the person may see; `expectedVersion` = its `updatedAt` |
| `iot_device` | `list_devices` | `iot_device.devices.read` | The workspace's devices (search, status, online, gateways), paged, up to 50; no credential, token or address |
| `iot_device` | `get_device` | `iot_device.devices.read` | One device: status, connection, firmware, last activity |
| `telemetry` | `get_latest_readings` | `telemetry.read` | The latest value of each key of one entity (kind `iot_device` for a device), if the kind lets the person read it |
| `telemetry` | `get_reading_series` | `telemetry.read` | Up to 10 keys over at most 31 days, bucketed and aggregated, at most 500 points a key (`truncated` beyond) |

`/api/mcp/observability` stays observability's own hand-written endpoint (exact `observability:mcp:*` key scopes, D57-20).

## Publish gate (MCP_Server_Design_Rules mcp-server-master.md §8)

Checked 2026-11-05 on main `d262aa2fe`. ✅ passed, — not applicable, ⚠️ a written exception or open.

| Row | State | How |
|---|---|---|
| P1 | ✅ | `BUILD_TARGET_REVISION = '2025-11-25'` (`server/mcp_server.protocol.ts`, the module's one date literal); `tests/mcp_server.protocol-drift.test.ts`; no boot assertion |
| P2, P3 | — | `(fwd)`: the project is pinned to `2025-11-25`; the SDK answers `server/discover` for 2026-07-28 requests itself |
| P4 | ✅ | `cacheHints` set explicitly, `tools/list` private (`server/mcp_server.server.ts`) |
| P5 | ✅ | the list varies by authorization only (`mcp_server.http.security.test.ts`: the same list twice) |
| P6 | ✅ | no `Mcp-Session-Id`, GET / DELETE 405, no removed feature used |
| T1–T3 | ✅ | the `mcp-tools` boot guard (`server/registry/mcp_server.registry.validate.ts`), tested rule by rule |
| T4 | ✅ | Zod object schemas in and out; `structuredContent` checked against the output schema plus a text block (`runGuardedCall`) |
| T5 | ✅ | one server per module keeps each list small (2–4 tools today); sorted by name |
| S1 | ✅ | Origin validated before authentication (forged Origin and `null` → 403, tested) |
| S2 | ✅ | OAuth tokens are bound to the workspace and the resource (RFC 8707), checked on every call; no passthrough anywhere |
| S3 | ✅ | `registerGuardedTool` is the only `registerTool` call site; filtered list; an unlisted tool is `-32602` with the handler not run (tested) |
| S4 | ⚠️ | OAuth 2.1 resource server for third-party hosts (row D-3). **EXCEPTION: S4 — API keys (static bearer) are also accepted for headless agents (CI, scripts) that cannot run a browser flow; they are tenant API keys with expiry, IP lists and a rate limit, and need `mcp_server.connect` — Kuray Karaaslan (owner direction "MCP keys go through the API keys"), 2026-11-05** |
| S5 | ✅ | no tool serves a path or URL from an argument; the client metadata fetch goes through `safeFetch` (public address pinned, no redirects, 3 s, 8 KiB) |
| S6 | ✅ | no secret in a schema or description; audit rows carry argument names only; tokens stored as SHA-256 only |
| S7 | ✅ | no state handles; OAuth codes and tokens are CSPRNG, hashed, bound to the tenant, the person and the client |
| S8 | ✅ | the token check fails closed (Redis or database down → 401, tested); revocation is the grant row, read on every call on every instance |
| R1 | ✅ | the host's idempotency store per tenant and credential (`IDEMPOTENCY_KEY_TTL` 24 h), tested: replay, concurrent, release on failure, pending after a timeout |
| R2 | ✅ | `update_*` tools need `expectedVersion` (boot guard); `update_task` answers CONFLICT on a stale version (tested); no delete tool exists (D57-21) |
| R3, R4 | ✅ | the envelope in the text block with `isError`, no `structuredContent`; `details` scalars only; thrown errors hidden as INTERNAL_ERROR (tested) |
| O1, O2 | — | no stdio server |
| O3 | ⚠️ | contract and security tests are in the suite; **open: an MCP Inspector round trip and one hosted-connector sign-in on a running app** (runbook below) |
| O4 | ✅ | `@modelcontextprotocol/server` 2.4.0 pinned exactly in `dependencies`, Zod 4, lockfile committed |
| O5 | ✅ | this README: transport, auth, every tool, limits, both revision rows |

### Live checks (O3), on a running app

The steps that need a running server (a dev server, a staging install or the demo); none was run here (owner rule: no dev server of
my own). On a tenant with Settings → MCP → "Let MCP clients connect" on:

1. **Key path**: create an API key with "Connect MCP clients" and "View tasks"; then
   `npx @modelcontextprotocol/inspector --cli <origin>/api/mcp/tasks --transport http --header "Authorization: Bearer <key>" --method tools/list`
   lists `list_tasks` and `get_task`; `--method tools/call --tool-name list_tasks` answers the person's tasks. Without the header: 401 with
   `WWW-Authenticate: … resource_metadata="…/api/mcp/oauth/protected-resource/tasks"`.
2. **Claude Code**: `claude mcp add --transport http tasks <origin>/api/mcp/tasks --header "Authorization: Bearer <key>"`, then ask for the
   open tasks.
3. **OAuth**: add `<origin>/api/mcp/tasks` as a custom connector in claude.ai (or the Inspector's OAuth flow): the consent screen names the
   app and `claude.ai`; after "Connect", Connected apps lists it; "Disconnect" stops the next call (401).
4. **Bundling**: the first request to the route compiles `@modelcontextprotocol/server` under Turbopack; a build error there is the one
   thing the unit tests could not show.
