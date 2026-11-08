/**
 * limiter's signal kinds for the AI firewall (`ai_firewall:signal`, docs/phases/55-ai-firewall/01 §1.6): address bans, their lift and the
 * promotion of a repeat offender (inventory §2, phase 55 00.2), the local CrowdSec decisions the edge sync reads back (00.7) and a touch of
 * a trap route (02.5). The
 * banned address is the row's subject (`ip` / the bucket), the actor the administrator or the system. Only the contract from common is
 * imported (ADR-0008 §2).
 *
 * Phase 55 02.6: the limiter's own refusals (`limiter.rate_limited`, tallied: one signal per tenant, lane, actor and refusing control every
 * few seconds with the count, common.firewall-tally.ts) and the misbehaviour divisor (`limiter.address_divided`), both emitted by this module
 * (limiter.firewall-emitters.ts), not audit rows.
 */
import { TALLY_SIGNAL_ATTRS } from '@kuraykaraaslan-labs/common/server/common.firewall-tally';
import {
  REFUSAL_ROW_METADATA,
  auditRowSignal,
  signalAttr as a,
  type FirewallSignalContribution,
} from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

const BAN = { ip: a.untrusted('network', 'the banned address or block') };

const SIGNALS: FirewallSignalContribution[] = [
  auditRowSignal({
    kind: 'security.ip_banned', severity: 'high', defaultWeight: 0.4, outcomes: ['deny'], actorKinds: ['anon', 'user'],
    metadata: { ...BAN, reason: a.untrusted(), offense: a.number(), seconds: a.number(), manual: a.flag(), source: a.untrusted('none', 'auto, manual or firewall') },
  }),
  auditRowSignal({ kind: 'security.ip_unbanned', severity: 'high', defaultWeight: 0.02, outcomes: ['info'], actorKinds: ['anon', 'user'], metadata: BAN }),
  auditRowSignal({
    kind: 'security.ip_ban_promoted', severity: 'high', defaultWeight: 0.5, outcomes: ['deny'], actorKinds: ['anon'],
    metadata: { ...BAN, offense: a.number(), threshold: a.number(), seconds: a.number(), source: a.untrusted() },
  }),
  auditRowSignal({
    kind: 'edge.decision', severity: 'medium', defaultWeight: 0.35, outcomes: ['deny'], actorKinds: ['ip', 'anon'],
    metadata: {
      ...REFUSAL_ROW_METADATA,
      decisionId: a.number(), origin: a.untrusted('none', 'crowdsec or cscli'), type: a.untrusted(), scope: a.untrusted(), scenario: a.untrusted('none', 'the CrowdSec scenario'),
      duration: a.untrusted(), simulated: a.flag(), country: a.untrusted('location'),
    },
  }),
  // Phase 55 02.5: a trap route was asked (limiter.trap-routes.ts; the dispatcher's missing-route 404 on a trap path). Emitted by this
  // module, not an audit row; never legitimate, so critical and a high-precision label for 03.
  {
    kind: 'limiter.trap_route_touched', emitted: true, severity: 'critical', defaultWeight: 1, outcomes: ['deny'],
    lanes: ['human-web', 'human-native', 'public-anon', 'machine-apikey', 'machine-agent', 'internal-cron', 'provider-webhook', 'device-iot', 'unknown'],
    actorKinds: ['user', 'ip', 'anon'],
    attrs: {
      trap: a.text('none', 'which trap: admin_backup, internal_env, legacy_admin, ...'),
      method: a.text('none', 'the HTTP method'),
      ip: a.text('network', 'the address of a signed-in caller (the actor is the person)'),
    },
  },
  // Phase 55 02.6: a request this limiter refused, tallied (limiter.firewall-emitters.ts). The actor is the person when their own bucket
  // refused, else the address's rate-limit bucket (an IPv4 address, an IPv6 /64).
  {
    kind: 'limiter.rate_limited', emitted: true, severity: 'low', defaultWeight: 0.15, outcomes: ['deny'],
    lanes: ['human-web', 'human-native', 'public-anon', 'machine-apikey', 'machine-agent', 'internal-cron', 'provider-webhook', 'device-iot', 'unknown'],
    actorKinds: ['ip', 'user', 'anon'],
    attrs: {
      ...TALLY_SIGNAL_ATTRS,
      scope: a.text('none', 'the limiter scope: api, auth, i18n or csp'),
      by: a.text('none', 'which control refused: address, user, endpoint, plan, unknown_client, ban or blocklist'),
      endpoint: a.text('none', 'the sign-in endpoint whose own budget refused: login, register, forgot or otp-send'),
    },
  },
  // Phase 55 02.6: the misbehaviour script divided an address's signed-in ceiling (300 misses in 5 minutes, D40-10(d)); platform-wide.
  {
    kind: 'limiter.address_divided', emitted: true, severity: 'medium', defaultWeight: 0.35, outcomes: ['deny'], lanes: ['unknown'], actorKinds: ['ip'],
    attrs: {
      divisor: a.number('none', 'the ceiling is divided by this: 2, or 4 on a repeat within the hour'),
      misses: a.number('none', 'the misses counted in the window'),
      seconds: a.number('none', 'how long the division lasts'),
    },
  },
];

export default SIGNALS;
