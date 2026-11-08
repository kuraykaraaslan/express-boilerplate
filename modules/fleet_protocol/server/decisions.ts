/**
 * The closed set of verdicts an agent reports for a command it was offered (03 §2 rules 1-8, §4 ack). One list for both
 * sides: the agent's `AgentDecision` must be a subset of it (checked at compile time in `agent.verifier.ts`) and the
 * control plane accepts exactly these, so the two can never drift into an ack the other refuses.
 */
export const ACK_DECISIONS = [
  'ACCEPTED',
  'REJECTED_SCHEMA', 'REJECTED_AUD', 'REJECTED_KID', 'REJECTED_ISSUER', 'REJECTED_SIGNATURE',
  'NOT_YET_VALID', 'EXPIRED', 'DUPLICATE', 'DEFERRED',
  'REJECTED_CATALOGUE', 'REJECTED_CLASS', 'REJECTED_APPROVALS', 'REJECTED_POLICY', 'REJECTED_VETO',
] as const;
export type AckDecision = (typeof ACK_DECISIONS)[number];
