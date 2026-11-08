/**
 * ai_firewall's own signal kinds (`ai_firewall:signal`). `ai_firewall.request_pattern` (02 §2.3, D55-31): the request fold's nomination of
 * an actor whose request counters of one flush are worth a look (detect/ai_firewall.request-pattern.ts): counts only, weight 0 (the
 * counters are already in the windows; the signal only names the actor to the detectors).
 *
 * `ai_firewall.action_mode_changed` (01 §1.8): a tenant admin changed what the firewall may do
 * on its own (the mode of one action, from the actions catalogue). Switching an action to Auto is exactly what a compromised admin
 * account would do before an attack (a lock-out weapon) or what an attacker undoes (Observe everywhere), so the change is a signal like
 * any other privileged change. The audit row is `ai_firewall.action_mode_changed` (ai_firewall.catalogue.service.ts).
 *
 * `ai_firewall.incident_status_changed` (02 §2.4): a person acknowledged, resolved (or marked as a false alarm) or reopened an incident
 * (ai_firewall.incident.service.ts). Closing the firewall's cases in bulk, or calling a real attack a false alarm, is what an attacker
 * with an admin account would do to hide, so the change is a signal too (low weight: one change is routine).
 *
 * `ai_firewall.incident_labelled` (03 §3.2): a person gave an incident a verdict (true positive with its class, false positive, unsure;
 * ai_firewall.incident.service.ts `label`). Calling real attacks false alarms teaches the calibration of 04.8 to look away, so a verdict is
 * a signal like the status change (low weight; the audit row of a false positive is medium).
 *
 * The tree models' promotion store (04.7, FWD-12): `ai_firewall.model_promoted` and `ai_firewall.model_demoted` (the automatic gate, a
 * SYSTEM row; a demotion also by an owner's hold), `ai_firewall.model_held` and `ai_firewall.model_released` (a ROOT owner's override,
 * with the owner's reason). Holding the models in shadow takes the cascade's enforcement away (the rules stay), which is what an attacker
 * with the owner's account would do before an attack, so the override is a signal (medium); a promotion or demotion is routine (weight 0).
 *
 * `ai_firewall.cascade_decision` (04.8, D55-117): the request cascade's decisions about one actor over one flush (about 5 s of one web
 * process), sent only when one was not `allow` (enforced or in shadow), an audit-sample request was a miss, or the actor hovers under a
 * threshold (4.11): counts, the strongest attack class and scores, the support references of the refused requests. Weight 0: the models'
 * verdicts never feed the rule floor back (the rules stay independent of the models, FWA-2); the signal names the actor to the detectors
 * and keeps the decision, and its references, on the actor's timeline.
 */
import { SIGNAL_LANES, auditRowSignal, signalAttr as a, type FirewallSignalContribution } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

const COUNT = (description: string) => a.number('none', description);

const SIGNALS: FirewallSignalContribution[] = [
  {
    kind: 'ai_firewall.request_pattern', severity: 'low', defaultWeight: 0, outcomes: ['info'],
    lanes: ['unknown', 'machine-apikey'], actorKinds: ['ip', 'user', 'apiKey'],
    attrs: {
      requests: COUNT('requests in the flush (about 5 s of one process)'),
      refusals: COUNT('401, 403 and 404 answers'),
      sequential: COUNT('sequential numeric-id steps'),
      indicators: COUNT('attack indicator tokens in paths and queries (counts only)'),
      authFailures: COUNT('failed sign-in answers'),
      headerAnomalies: COUNT('requests with a header anomaly'),
      deepPages: COUNT('list requests at page 10 or deeper'),
      exportBytes: COUNT('bytes answered on export routes'),
      adminWrites: COUNT('admin writes'),
      scripted: COUNT('requests from a script, library, bot or empty user agent'),
      regular: COUNT('requests whose timing repeats the previous gap'),
      role: a.text('none', 'the caller\'s member role'),
    },
  },
  {
    kind: 'ai_firewall.cascade_decision', severity: 'medium', defaultWeight: 0, outcomes: ['info', 'deny'], emitted: true,
    lanes: SIGNAL_LANES, actorKinds: ['ip', 'user'],
    attrs: {
      decisions: COUNT('decisions tallied for the actor in the flush (a verdict other than allow, an audit-sample miss, hovering)'),
      challenges: COUNT('verdicts: challenge'),
      blocks: COUNT('verdicts: block'),
      enforced: COUNT('decisions applied to the request (the cascade enforcing)'),
      shadow: COUNT('decisions recorded only (the cascade in shadow)'),
      auditMisses: COUNT('audit-sample requests stage 1 let through that stage 2 would have challenged'),
      attackClass: a.text('none', 'the most likely attack class at the strongest decision'),
      attackScore: COUNT('the strongest attack probability, × 100'),
      behaviourScore: COUNT('the strongest behaviour probability, × 100'),
      references: a.text('none', 'support references of the refused requests, comma-separated, at most 5'),
      hovering: a.text('none', 'the thresholds the actor keeps scoring just under: suspicion, challenge, block'),
    },
  },
  auditRowSignal({
    kind: 'ai_firewall.action_mode_changed', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'],
    metadata: {
      actionId: a.untrusted('none', 'the registered action whose mode changed'),
      from: a.untrusted('none', 'observe, suggest, auto or default'),
      to: a.untrusted('none', 'observe, suggest, auto or default'),
    },
  }),
  auditRowSignal({
    kind: 'ai_firewall.incident_status_changed', severity: 'low', defaultWeight: 0.1, outcomes: ['info'],
    metadata: {
      from: a.untrusted('none', 'open, acknowledged or closed'),
      to: a.untrusted('none', 'open, acknowledged or closed'),
      closeReason: a.untrusted('none', 'resolved or false_positive, when it was closed'),
      actorKind: a.untrusted('none', 'the kind of actor the incident is about'),
    },
  }),
  auditRowSignal({
    kind: 'ai_firewall.incident_labelled', severity: 'low', defaultWeight: 0.1, outcomes: ['info'],
    metadata: {
      verdict: a.untrusted('none', 'true_positive, false_positive or unsure'),
      labelClass: a.untrusted('none', 'the class of the label: a detector id, benign or other'),
      previousVerdict: a.untrusted('none', 'the verdict it replaced, when there was one'),
      actorKind: a.untrusted('none', 'the kind of actor the incident is about'),
    },
  }),
  ...(['ai_firewall.model_promoted', 'ai_firewall.model_demoted'] as const).map((kind) => auditRowSignal({
    kind, severity: 'medium', defaultWeight: 0, outcomes: ['info'], actorKinds: ['anon', 'user'],
    metadata: {
      model: a.untrusted('none', 'behaviour or attack'),
      sha: a.untrusted('none', 'the first 12 hex characters of the model file\'s sha256'),
      state: a.untrusted('none', 'shadow or promoted, after the change'),
      reason: a.untrusted('none', 'the failing criteria of a demotion, or model_changed, model_unloaded, held'),
    },
  })),
  ...(['ai_firewall.model_held', 'ai_firewall.model_released'] as const).map((kind) => auditRowSignal({
    kind, severity: 'medium', defaultWeight: 0.2, outcomes: ['info'],
    metadata: {
      model: a.untrusted('none', 'behaviour or attack'),
      sha: a.untrusted('none', 'the first 12 hex characters of the model file\'s sha256'),
      state: a.untrusted('none', 'shadow or promoted, after the change'),
      note: a.untrusted('content', 'the owner\'s reason, free text'),
    },
  })),
];

export default SIGNALS;
