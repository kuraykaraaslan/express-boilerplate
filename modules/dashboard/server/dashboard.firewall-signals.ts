/**
 * dashboard's signal kinds for the AI firewall (`ai_firewall:signal`, docs/phases/55-ai-firewall/01 §1.6): every board, placement,
 * widget, card overlay and scene binding write of `dashboard.audit.ts` (`BoardAuditAction`), the display links a screen signs in with
 * (minted and revoked) and what a screen did through one (`DisplayAuditAction`: opened the board, read its cards, was refused). A board
 * write's actor is the person; a display row has no actor (a screen is not a person: the row is the system's, with the issuer whose
 * authority the screen borrowed in its metadata, and never the token). Other modules write two of these kinds too (dashboard_scada's
 * sample boards and a diagram made from a card, dashboard_viewer's designs made from a diagram): they are registered once, here.
 * Only the contract from common is imported.
 */
import { auditRowSignal, signalAttr as a, type FirewallSignalContribution } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

const PERSON = ['user'] as const;
const PERSON_OR_SYSTEM = ['user', 'anon'] as const;
const SCREEN = ['anon'] as const;

const BOARD = { boardId: a.untrusted('none') };
const SCOPE = { scope: a.untrusted('none', 'personal or workspace') };
const GATED = { skipped: a.number('none', 'cards left out'), droppedCommands: a.number('none', 'command actions the caller could not run') };
const LINK = { ...BOARD, label: a.untrusted('content', 'the link\'s label, as its issuer wrote it'), tokenHint: a.untrusted('none', 'the last characters of the token, never the token') };
const SCREEN_ROW = { ...BOARD, issuerUserId: a.untrusted('identifier', 'the person whose authority the screen borrowed') };
const SUBJECT = { subjectType: a.untrusted('none', 'the entity type a card or a scene shows'), subjectId: a.untrusted('none', 'the entity it shows (a device, an asset)') };
const BINDING = {
  ...SUBJECT, slot: a.untrusted('none'), kind: a.untrusted('none', 'the document kind (a design, a diagram)'), documentId: a.untrusted('none'),
  revision: a.number(),
};
const WIDGET = { type: a.untrusted('none', 'the widget type') };

const SIGNALS: FirewallSignalContribution[] = [
  // ── boards ──
  auditRowSignal({
    kind: 'dashboard.board.create', severity: 'low', defaultWeight: 0.03, outcomes: ['info'], actorKinds: [...PERSON_OR_SYSTEM],
    metadata: { ...SCOPE, sample: a.untrusted('none', 'the sample board a module installed'), source: a.untrusted('none', 'the module that made it') },
  }),
  auditRowSignal({ kind: 'dashboard.board.update', severity: 'low', defaultWeight: 0.03, outcomes: ['info'], actorKinds: [...PERSON] }),
  // a personal board shown to the whole workspace: who may see it changed
  auditRowSignal({ kind: 'dashboard.board.share', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: [...PERSON] }),
  auditRowSignal({
    kind: 'dashboard.board.delete', severity: 'low', defaultWeight: 0.1, outcomes: ['info'], actorKinds: [...PERSON],
    metadata: { ...SCOPE, title: a.untrusted('content', 'the board\'s title') },
  }),
  auditRowSignal({
    kind: 'dashboard.board.duplicate', severity: 'low', defaultWeight: 0.03, outcomes: ['info'], actorKinds: [...PERSON],
    metadata: { sourceBoardId: a.untrusted('none'), ...SCOPE, ...GATED },
  }),
  // a board package leaves the platform: weighed like an export
  auditRowSignal({
    kind: 'dashboard.board.export', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: [...PERSON],
    metadata: { boards: a.number(), placements: a.number(), skipped: a.number(), leftOut: a.number('none', 'cards left out of the package') },
  }),
  auditRowSignal({
    kind: 'dashboard.board.import', severity: 'low', defaultWeight: 0.05, outcomes: ['info'], actorKinds: [...PERSON],
    metadata: {
      total: a.number(), imported: a.number(), skipped: a.number(), repaired: a.number(), issues: a.number(), ...SCOPE,
      bundle: a.number('none', 'boards in the bundle'),
    },
  }),
  auditRowSignal({ kind: 'dashboard.board.layout', severity: 'low', defaultWeight: 0.02, outcomes: ['info'], actorKinds: [...PERSON], metadata: { cards: a.number(), revision: a.number() } }),
  auditRowSignal({
    kind: 'dashboard.board.restore', severity: 'low', defaultWeight: 0.05, outcomes: ['info'], actorKinds: [...PERSON],
    metadata: {
      revision: a.number(), overwrite: a.flag(), board: a.number('none', 'board fields put back'), cards: a.number(), overlays: a.number(),
      changes: a.number(), skipped: a.number(),
    },
  }),
  auditRowSignal({
    kind: 'dashboard.board.template_apply', severity: 'low', defaultWeight: 0.03, outcomes: ['info'], actorKinds: [...PERSON],
    metadata: {
      templateKey: a.untrusted('none'), ...GATED, asNew: a.flag(), ...SCOPE, answered: a.number('none', 'questions of the template answered'),
      onto: a.flag('none', 'placed onto an existing board'), placed: a.number(),
    },
  }),
  // ── placements ──
  auditRowSignal({ kind: 'dashboard.placement.create', severity: 'low', defaultWeight: 0.02, outcomes: ['info'], actorKinds: [...PERSON], metadata: { ...BOARD, widgetRef: a.untrusted('none') } }),
  auditRowSignal({ kind: 'dashboard.placement.update', severity: 'low', defaultWeight: 0.02, outcomes: ['info'], actorKinds: [...PERSON], metadata: BOARD }),
  auditRowSignal({ kind: 'dashboard.placement.delete', severity: 'low', defaultWeight: 0.1, outcomes: ['info'], actorKinds: [...PERSON], metadata: { ...BOARD, widgetRef: a.untrusted('none') } }),
  // ── the widget library: what every board that places a widget renders ──
  auditRowSignal({ kind: 'dashboard.widget.create', severity: 'low', defaultWeight: 0.03, outcomes: ['info'], actorKinds: [...PERSON], metadata: { ...WIDGET, visibility: a.untrusted('none') } }),
  auditRowSignal({ kind: 'dashboard.widget.update', severity: 'low', defaultWeight: 0.03, outcomes: ['info'], actorKinds: [...PERSON], metadata: WIDGET }),
  auditRowSignal({ kind: 'dashboard.widget.delete', severity: 'low', defaultWeight: 0.1, outcomes: ['info'], actorKinds: [...PERSON], metadata: WIDGET }),
  auditRowSignal({ kind: 'dashboard.widget.publish', severity: 'low', defaultWeight: 0.1, outcomes: ['info'], actorKinds: [...PERSON], metadata: WIDGET }),
  auditRowSignal({
    kind: 'dashboard.widget.transition', severity: 'low', defaultWeight: 0.1, outcomes: ['info'], actorKinds: [...PERSON],
    metadata: { ...WIDGET, action: a.untrusted('none', 'the transition asked'), status: a.untrusted('none', 'the status it moved to') },
  }),
  auditRowSignal({
    kind: 'dashboard.widget.import', severity: 'low', defaultWeight: 0.05, outcomes: ['info'], actorKinds: [...PERSON],
    metadata: { overwrite: a.flag(), created: a.number(), updated: a.number(), skipped: a.number(), notes: a.number() },
  }),
  // ── display links: a screen's credential ──
  auditRowSignal({
    kind: 'dashboard.display_link.create', severity: 'medium', defaultWeight: 0.3, outcomes: ['info'], actorKinds: [...PERSON],
    metadata: { ...LINK, expiresAt: a.untrusted('none') },
  }),
  auditRowSignal({ kind: 'dashboard.display_link.revoke', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: [...PERSON], metadata: LINK }),
  auditRowSignal({
    kind: 'dashboard.display.open', severity: 'low', defaultWeight: 0.02, outcomes: ['info'], actorKinds: [...SCREEN],
    metadata: { ...SCREEN_ROW, cards: a.number(), overlays: a.number() },
  }),
  auditRowSignal({ kind: 'dashboard.display.read', severity: 'low', defaultWeight: 0.02, outcomes: ['info'], actorKinds: [...SCREEN], metadata: { ...SCREEN_ROW, items: a.number() } }),
  // a refused screen: a revoked, expired or foreign link presented (throttled to one row per link a minute)
  auditRowSignal({
    kind: 'dashboard.display.denied', severity: 'medium', defaultWeight: 0.2, outcomes: ['deny'], actorKinds: [...SCREEN],
    metadata: { ...SCREEN_ROW, status: a.number('none', 'the HTTP status of the refusal'), reason: a.untrusted('none', 'the refusal\'s message') },
  }),
  // ── card overlays: a card's settings for one subject ──
  auditRowSignal({
    kind: 'dashboard.card_overlay.set', severity: 'low', defaultWeight: 0.02, outcomes: ['info'], actorKinds: [...PERSON],
    metadata: { ...BOARD, instanceId: a.untrusted('none'), ...SUBJECT, revision: a.number() },
  }),
  auditRowSignal({
    kind: 'dashboard.card_overlay.reset', severity: 'low', defaultWeight: 0.1, outcomes: ['info'], actorKinds: [...PERSON],
    metadata: { ...BOARD, instanceId: a.untrusted('none'), ...SUBJECT },
  }),
  // ── scene bindings: which document a subject shows and which device is which ──
  auditRowSignal({
    kind: 'dashboard.scene_binding.set', severity: 'low', defaultWeight: 0.03, outcomes: ['info'], actorKinds: [...PERSON_OR_SYSTEM],
    metadata: {
      ...BINDING, created: a.flag(), allocated: a.flag('none', 'a slot was allocated for it'),
      fromDiagram: a.untrusted('none', 'the drawing a design was made from'), fromCard: a.untrusted('none', 'the card a diagram was made from'),
      // dashboard_viewer's "make a 3D view from a drawing" writes these too (one registration for every writer, D55-160)
      rules: a.number(), staleRuleTargets: a.number(),
    },
  }),
  auditRowSignal({ kind: 'dashboard.scene_binding.reset', severity: 'low', defaultWeight: 0.1, outcomes: ['info'], actorKinds: [...PERSON], metadata: BINDING }),
  auditRowSignal({
    kind: 'dashboard.scene_binding.bulk', severity: 'low', defaultWeight: 0.05, outcomes: ['info'], actorKinds: [...PERSON],
    metadata: {
      subjectType: SUBJECT.subjectType, profileId: a.untrusted('none', 'the device profile'), slot: a.untrusted('none'), kind: BINDING.kind,
      documentId: a.untrusted('none'), mapFrom: a.untrusted('none', 'identity or twin-index'), bound: a.number('none', 'devices bound'),
      copiedEntries: a.number(), copyFrom: a.untrusted('none', 'the device whose connections were copied'), skipped: a.number(),
      failed: a.flag('none', 'the call failed part way; bound says how many were written'),
    },
  }),
];

export default SIGNALS;
