/**
 * limiter's decoy for the AI firewall (`ai_firewall:honeytoken`, docs/phases/55-ai-firewall/02 §2.5): the trap routes
 * (limiter.trap-routes.ts). They are the same for every tenant and nothing is planted (a trap is a path no module declares); `plant` names
 * them for the canary list. Only the contract from common is imported at load.
 */
import type { HoneytokenContribution, PlantedHoneytoken } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

const HONEYTOKENS: HoneytokenContribution[] = [
  {
    id: 'limiter.trap_routes',
    kind: 'route',
    labelKey: 'limiter.firewallHoneytoken.trap_routes.label',
    descriptionKey: 'limiter.firewallHoneytoken.trap_routes.description',
    detector: { signalKind: 'limiter.trap_route_touched' },
    async plant(): Promise<PlantedHoneytoken | null> {
      const paths = Object.keys((await import('./limiter.trap-routes')).TRAP_ROUTES);
      return { ref: String(paths.length), bait: paths.join('\n'), where: '/api/...' };
    },
  },
];

export default HONEYTOKENS;
