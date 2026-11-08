/**
 * mcp_server's signal kinds for the AI firewall (`ai_firewall:signal`; docs/phases/57-mcp-server D57-11): every MCP tool call is an
 * audit row (mcp_server.calls), and the audit intake turns each into a signal. A call that ran (whatever the tool answered) is
 * `mcp_server.tool.called`; one the host refused (a tool the credential may not use, a spent rate budget) is `mcp_server.tool.refused`.
 * The actor is the credential (an API_KEY row: lane machine-apikey, keyed on the key, never on an address, 38 L-4). Argument values and
 * results never travel; the argument NAMES are an array and are not declared. Only the contract from common is imported.
 */
import { auditRowSignal, signalAttr as a, type FirewallSignalContribution } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

const CALL_LANES = ['machine-apikey', 'machine-mcp', 'unknown'] as const;
const ACTORS = ['apiKey', 'session', 'anon'] as const;
/** An OAuth grant's call is an actorless row naming the grant: weighed against the grant (a `session`), D443. */
const GRANT_ROW = { kind: 'session', from: 'metadata', field: 'grantId' } as const;
const GRANT_SUBJECT = { kind: 'session', from: 'subject', subjectType: 'mcp_oauth_grant' } as const;
const CALL = {
  surface: a.untrusted('none', 'always mcp'),
  server: a.untrusted('none', 'the module whose MCP server was called'),
  tool: a.untrusted('none', 'the tool name'),
  kind: a.untrusted('none', 'read or write'),
  outcome: a.untrusted('none', 'ok, error, timeout, denied or rate_limited'),
  code: a.untrusted('none', 'the error envelope code, when there was one'),
  durationMs: a.number('none', 'how long the call took'),
  holderUserId: a.untrusted('identifier', 'the person the credential acts as'),
  grantId: a.untrusted('identifier', 'the OAuth grant of the call, when it came through one'),
  lane: a.untrusted('none', 'machine-mcp for an OAuth grant\'s call'),
};
const GRANT = {
  surface: a.untrusted('none', 'always mcp'),
  clientHost: a.untrusted('none', 'the host of the MCP client'),
  scope: a.untrusted('none', 'the scope consented to'),
  by: a.untrusted('none', 'owner, admin or client: who revoked it'),
};

const SIGNALS: FirewallSignalContribution[] = [
  auditRowSignal({
    kind: 'mcp_server.tool.called', severity: 'low', defaultWeight: 0.02, outcomes: ['allow', 'fail', 'info'], lanes: [...CALL_LANES],
    actorKinds: [...ACTORS], metadata: CALL, systemRowActor: GRANT_ROW,
  }),
  auditRowSignal({
    kind: 'mcp_server.tool.refused', severity: 'medium', defaultWeight: 0.3, outcomes: ['deny'], lanes: [...CALL_LANES],
    actorKinds: [...ACTORS], metadata: CALL, systemRowActor: GRANT_ROW,
  }),
  // The OAuth grants (57.3): a person connected an AI app, an app's grant was revoked, a refresh token was used twice (a stolen copy).
  auditRowSignal({ kind: 'mcp_server.grant.created', severity: 'low', defaultWeight: 0.05, outcomes: ['info'], actorKinds: ['user'], metadata: GRANT }),
  auditRowSignal({ kind: 'mcp_server.grant.revoked', severity: 'low', defaultWeight: 0.02, outcomes: ['info'], actorKinds: ['user', 'anon'], metadata: GRANT }),
  auditRowSignal({
    kind: 'mcp_server.grant.refresh_reused', severity: 'high', defaultWeight: 0.6, outcomes: ['deny'], lanes: ['machine-mcp', 'unknown'],
    actorKinds: ['session', 'anon'], metadata: GRANT, systemRowActor: GRANT_SUBJECT,
  }),
  auditRowSignal({ kind: 'mcp_server.grant.suspended', severity: 'medium', defaultWeight: 0.02, outcomes: ['info'], actorKinds: ['session', 'anon'], metadata: GRANT, systemRowActor: GRANT_SUBJECT }),
  auditRowSignal({ kind: 'mcp_server.grant.resumed', severity: 'low', defaultWeight: 0.02, outcomes: ['info'], actorKinds: ['session', 'anon'], metadata: GRANT, systemRowActor: GRANT_SUBJECT }),
  // Emitted, not audited: the token endpoint's refusals (tallied) and a touch of the decoy access token (critical: nobody can hold it).
  {
    kind: 'mcp_server.token.refused', emitted: true, severity: 'medium', defaultWeight: 0.2, outcomes: ['deny'], lanes: ['public-anon'], actorKinds: ['anon', 'ip'],
    attrs: { reason: a.text('none', 'why the token endpoint refused'), clientHost: a.untrusted('none', 'the host of the client_id it named') },
  },
  {
    kind: 'mcp_server.decoy_token_touched', emitted: true, severity: 'critical', defaultWeight: 1, outcomes: ['deny'], lanes: ['public-anon'], actorKinds: ['ip', 'anon'],
    attrs: {},
  },
];

export default SIGNALS;
