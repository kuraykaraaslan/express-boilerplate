import {
  ACTOR_KINDS,
  FIREWALL_ACTION_SCOPES,
  FIREWALL_ACTION_TTL_CAP_MS,
  FIREWALL_BOUND_EVIDENCE_RUNGS,
  FIREWALL_HUMAN_RUNGS,
  FIREWALL_MODES,
  FIREWALL_RUNGS,
  PERSONAL_DATA_CLASSES,
  SIGNAL_ATTRS_MAX,
  SIGNAL_ATTR_TYPES,
  SIGNAL_ID_MAX,
  SIGNAL_LANES,
  SIGNAL_OUTCOMES,
  SIGNAL_SEVERITIES,
  isSignalAttrKey,
  isSignalKind,
  type FirewallActionContribution,
  type FirewallSignalContribution,
  type HoneytokenContribution,
} from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';
import { LANES, LANE_POLICY, type Lane } from '@kuraykaraaslan-labs/common/server/lane.policy';

/**
 * The boot checks of the firewall's four registries (docs/phases/55-ai-firewall/01 §1.5). Pure: it gets what the loader
 * (`ai_firewall.registry.ts`) loaded and answers every problem at once plus the catalogue of what passed. Any problem refuses the boot
 * (the `ai-firewall-registries` guard): a registry the responder cannot trust is a build defect, never something to run around.
 *
 * | Point | Refused |
 * |---|---|
 * | `ai_firewall:signal` | a kind registered twice; an attribute without a personal-data class; a malformed declaration (a `systemRowActor` on an emitted kind, malformed, or naming an actor kind it does not list) |
 * | `ai_firewall:action` | no `undo` (FWA-4); a human rung on a machine or device lane, a step-up on a lane without step-up, an address actor on a lane that never bans addresses (FWA-6, read from `LANE_POLICY`); a TTL max above the platform cap; strong evidence not bound to the actor (FWA-5); an evidence kind nobody registered |
 * | `ai_firewall:honeytoken` | a decoy without a detector, or whose detector's signal kind nobody registered or registered below critical |
 * | `ai_firewall:analyst` | more than one provider (select, fallback none: the firewall would not know which one triages) |
 *
 * Every contribution of the three catalogs lists its identities in `metadata.ids` (the snapshot's `uniqueMetadata` refuses a duplicate
 * across manifests at build time); the loaded identities must be exactly those, so the manifest the checks read cannot claim what the
 * code does not register. A contribution that could not be loaded is a problem too.
 */

export const SIGNAL_POINT = 'ai_firewall:signal';
export const ACTION_POINT = 'ai_firewall:action';
export const HONEYTOKEN_POINT = 'ai_firewall:honeytoken';
export const ANALYST_POINT = 'ai_firewall:analyst';

export type FirewallPoint = typeof SIGNAL_POINT | typeof ACTION_POINT | typeof HONEYTOKEN_POINT | typeof ANALYST_POINT;

/** One contribution as the loader found it. `ids` is its `metadata.ids` (null when it declares none). */
export interface LoadedContribution {
  contributionId: string;
  moduleId: string;
  ids: readonly string[] | null;
  impl: unknown;
}

export interface RegistryInput {
  signals: readonly LoadedContribution[];
  actions: readonly LoadedContribution[];
  honeytokens: readonly LoadedContribution[];
  analysts: readonly LoadedContribution[];
  /** Contributions that could not be loaded (an import that threw, a timeout). */
  failed: ReadonlyArray<{ point: FirewallPoint; contributionId: string; message: string }>;
}

export type RegistryProblemCode =
  | 'load_failed'
  | 'ids_missing'
  | 'ids_mismatch'
  | 'signal.invalid'
  | 'signal.duplicate'
  | 'signal.attr_without_pd_class'
  | 'action.invalid'
  | 'action.foreign_id'
  | 'action.duplicate'
  | 'action.no_undo'
  | 'action.irreversible_auto'
  | 'action.human_rung_on_machine_lane'
  | 'action.step_up_lane'
  | 'action.per_ip_on_machine_lane'
  | 'action.ttl_above_cap'
  | 'action.evidence_not_bound'
  | 'action.unknown_evidence_kind'
  | 'honeytoken.invalid'
  | 'honeytoken.foreign_id'
  | 'honeytoken.duplicate'
  | 'honeytoken.no_detector'
  | 'honeytoken.unregistered_detector'
  | 'honeytoken.detector_not_critical'
  | 'analyst.invalid'
  | 'analyst.more_than_one';

export interface RegistryProblem {
  point: FirewallPoint;
  contributionId: string;
  /** The identity it is about (a kind, an action or decoy id), when there is one. */
  id?: string;
  code: RegistryProblemCode;
  message: string;
}

interface Owned { moduleId: string; contributionId: string }
export type RegisteredSignal = FirewallSignalContribution & Owned;
export type RegisteredAction = FirewallActionContribution & Owned;
export type RegisteredHoneytoken = HoneytokenContribution & Owned;

export interface FirewallCatalog {
  signals: ReadonlyMap<string, RegisteredSignal>;
  actions: ReadonlyMap<string, RegisteredAction>;
  honeytokens: ReadonlyMap<string, RegisteredHoneytoken>;
  /** The one analyst, or null (fallback none: explanations come from templates). */
  analyst: Owned | null;
}

export interface RegistryVerdict {
  ok: boolean;
  problems: RegistryProblem[];
  /** What passed (a refused declaration is left out). */
  catalog: FirewallCatalog;
}

/** A person's lane: the limiter keys it per address (`human-web`, `human-native`, `public-anon`). Every other lane is a machine's or a device's. */
export const isHumanLane = (lane: Lane): boolean => LANE_POLICY[lane].limiterKeying === 'ip';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isFn = (v: unknown): boolean => typeof v === 'function';
const isPosInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;
const isNonNegInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : [v]);
const nonEmptySubset = <T extends string>(v: unknown, of: readonly T[]): v is readonly T[] =>
  Array.isArray(v) && v.length > 0 && v.every((x) => (of as readonly string[]).includes(x as string));
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join('\0') === [...b].sort().join('\0');
/** `<module>.<name>`, lower case: an action or decoy id. */
const OWNED_ID_RE = /^([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)$/;

function signalProblems(s: unknown): { problems: Array<{ code: RegistryProblemCode; message: string }>; kind: string | null } {
  const out: Array<{ code: RegistryProblemCode; message: string }> = [];
  if (!isObject(s)) return { problems: [{ code: 'signal.invalid', message: 'the declaration is not an object' }], kind: null };
  const kind = isSignalKind(s.kind) ? s.kind : null;
  if (!kind) out.push({ code: 'signal.invalid', message: `kind ${JSON.stringify(s.kind)} is not a signal kind ([A-Za-z0-9_.:-], 1..128)` });
  if (!nonEmptySubset(s.lanes, SIGNAL_LANES)) out.push({ code: 'signal.invalid', message: `lanes must be a non-empty list of ${SIGNAL_LANES.join(', ')}` });
  if (!nonEmptySubset(s.actorKinds, ACTOR_KINDS)) out.push({ code: 'signal.invalid', message: `actorKinds must be a non-empty list of ${ACTOR_KINDS.join(', ')}` });
  if (s.outcomes !== undefined && !nonEmptySubset(s.outcomes, SIGNAL_OUTCOMES)) out.push({ code: 'signal.invalid', message: `outcomes must be a non-empty list of ${SIGNAL_OUTCOMES.join(', ')}` });
  if (!(SIGNAL_SEVERITIES as readonly unknown[]).includes(s.severity)) out.push({ code: 'signal.invalid', message: `severity must be one of ${SIGNAL_SEVERITIES.join(', ')}` });
  if (typeof s.defaultWeight !== 'number' || !Number.isFinite(s.defaultWeight) || s.defaultWeight < 0 || s.defaultWeight > 1) {
    out.push({ code: 'signal.invalid', message: 'defaultWeight must be a number from 0 to 1' });
  }
  if (s.labelKey !== undefined && (typeof s.labelKey !== 'string' || !s.labelKey)) out.push({ code: 'signal.invalid', message: 'labelKey must be a dictionary key' });
  if (s.emitted !== undefined && s.emitted !== true) out.push({ code: 'signal.invalid', message: 'emitted is true or absent' });
  if (s.systemRowActor !== undefined) {
    const sa = s.systemRowActor;
    const name = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= SIGNAL_ID_MAX;
    if (s.emitted === true) out.push({ code: 'signal.invalid', message: 'systemRowActor is an audit row\'s declaration: an emitted kind names its actor itself' });
    if (!isObject(sa) || !((sa.from === 'subject' && name(sa.subjectType)) || (sa.from === 'metadata' && name(sa.field)))) {
      out.push({ code: 'signal.invalid', message: "systemRowActor must be { kind, from: 'subject', subjectType } or { kind, from: 'metadata', field } (1..128 characters)" });
    } else if (!(ACTOR_KINDS as readonly unknown[]).includes(sa.kind) || !Array.isArray(s.actorKinds) || !s.actorKinds.includes(sa.kind)) {
      out.push({ code: 'signal.invalid', message: `systemRowActor.kind ${JSON.stringify(sa.kind)} must be an actor kind the declaration lists in actorKinds` });
    }
  }
  if (!isObject(s.attrs)) {
    out.push({ code: 'signal.invalid', message: 'attrs must be an object of attribute name -> { type, pd }' });
  } else {
    const names = Object.keys(s.attrs);
    if (names.length > SIGNAL_ATTRS_MAX) out.push({ code: 'signal.invalid', message: `at most ${SIGNAL_ATTRS_MAX} attributes (a signal carries no more), got ${names.length}` });
    for (const name of names) {
      const a = s.attrs[name];
      if (!isSignalAttrKey(name)) out.push({ code: 'signal.invalid', message: `attribute name ${JSON.stringify(name)} is not one a signal can carry` });
      if (!isObject(a) || !(SIGNAL_ATTR_TYPES as readonly unknown[]).includes(a.type)) {
        out.push({ code: 'signal.invalid', message: `attribute '${name}' needs a type (${SIGNAL_ATTR_TYPES.join(', ')})` });
      }
      if (!isObject(a) || !(PERSONAL_DATA_CLASSES as readonly unknown[]).includes(a.pd)) {
        out.push({ code: 'signal.attr_without_pd_class', message: `attribute '${name}' has no personal-data class (pd: ${PERSONAL_DATA_CLASSES.join(', ')})` });
      }
    }
  }
  return { problems: out, kind };
}

function actionProblems(a: unknown, moduleId: string, kinds: ReadonlyMap<string, unknown>): Array<{ code: RegistryProblemCode; message: string }> {
  const out: Array<{ code: RegistryProblemCode; message: string }> = [];
  if (!isObject(a)) return [{ code: 'action.invalid', message: 'the declaration is not an object' }];
  const m = typeof a.id === 'string' ? OWNED_ID_RE.exec(a.id) : null;
  if (!m) out.push({ code: 'action.invalid', message: `id ${JSON.stringify(a.id)} must be '<module>.<verb>' in lower case` });
  else if (m[1] !== moduleId) out.push({ code: 'action.foreign_id', message: `id '${a.id}' names module '${m[1]}', but '${moduleId}' registers it (an action is the owning module's)` });
  if (!isFn(a.undo)) out.push({ code: 'action.no_undo', message: 'no undo: every action must revert what it did (FWA-4)' });
  if (!isFn(a.execute)) out.push({ code: 'action.invalid', message: 'execute must be a function' });
  const rung = (FIREWALL_RUNGS as readonly unknown[]).includes(a.rung) ? (a.rung as (typeof FIREWALL_RUNGS)[number]) : null;
  if (!rung) out.push({ code: 'action.invalid', message: `rung must be one of ${FIREWALL_RUNGS.join(', ')}` });
  const lanes = nonEmptySubset(a.lanes, LANES) ? (a.lanes as readonly Lane[]) : null;
  if (!lanes) out.push({ code: 'action.invalid', message: `lanes must be a non-empty list of ${LANES.join(', ')}` });
  const actorKinds = nonEmptySubset(a.actorKinds, ACTOR_KINDS) ? (a.actorKinds as readonly (typeof ACTOR_KINDS)[number][]) : null;
  if (!actorKinds) out.push({ code: 'action.invalid', message: `actorKinds must be a non-empty list of ${ACTOR_KINDS.join(', ')}` });
  if (rung && lanes) {
    const machine = lanes.filter((l) => !isHumanLane(l));
    if (FIREWALL_HUMAN_RUNGS.includes(rung) && machine.length) {
      out.push({ code: 'action.human_rung_on_machine_lane', message: `rung '${rung}' acts on a person and may not run on the machine or device lane(s) ${machine.join(', ')} (FWA-6)` });
    }
    const noStepUp = lanes.filter((l) => !LANE_POLICY[l].stepUp);
    if (rung === 'step_up' && noStepUp.length) {
      out.push({ code: 'action.step_up_lane', message: `step-up is not a control of the lane(s) ${noStepUp.join(', ')} (LANE_POLICY.stepUp)` });
    }
  }
  if (lanes && actorKinds?.includes('ip')) {
    const noAddressBans = lanes.filter((l) => LANE_POLICY[l].banParticipation !== true);
    if (noAddressBans.length) {
      out.push({ code: 'action.per_ip_on_machine_lane', message: `acts on an address on the lane(s) ${noAddressBans.join(', ')}, which are acted on per credential, serial or node, never per address (FWA-6)` });
    }
  }
  const ttl = a.ttl;
  if (!isObject(ttl) || !isPosInt(ttl.defaultMs) || !isPosInt(ttl.maxMs)) {
    out.push({ code: 'action.invalid', message: 'ttl must be { defaultMs, maxMs }, whole positive milliseconds' });
  } else {
    if (ttl.defaultMs > ttl.maxMs) out.push({ code: 'action.invalid', message: `ttl.defaultMs (${ttl.defaultMs}) is above ttl.maxMs (${ttl.maxMs})` });
    if (ttl.maxMs > FIREWALL_ACTION_TTL_CAP_MS) {
      out.push({ code: 'action.ttl_above_cap', message: `ttl.maxMs ${ttl.maxMs} is above the platform cap ${FIREWALL_ACTION_TTL_CAP_MS} (30 days)` });
    }
  }
  if (a.minimumMode !== 'suggest' && a.minimumMode !== 'auto') out.push({ code: 'action.invalid', message: "minimumMode must be 'suggest' or 'auto'" });
  if (a.defaultMode !== undefined && !(FIREWALL_MODES as readonly unknown[]).includes(a.defaultMode)) {
    out.push({ code: 'action.invalid', message: `defaultMode must be one of ${FIREWALL_MODES.join(', ')}` });
  }
  if (!isNonNegInt(a.hourlyBudget)) out.push({ code: 'action.invalid', message: 'hourlyBudget must be a whole number of runs, 0 or more' });
  if (a.reversible !== undefined && typeof a.reversible !== 'boolean') out.push({ code: 'action.invalid', message: 'reversible must be true or false when it is given' });
  // FWA-4 / D55-9: reversibility is what makes Auto acceptable, so a run that cannot be undone always has a person approve it.
  if (a.reversible === false && a.minimumMode !== 'suggest') {
    out.push({ code: 'action.irreversible_auto', message: "an action whose run cannot be undone (reversible: false) must declare minimumMode 'suggest': a person approves every run (FWA-4, D55-9)" });
  }
  if (a.scope !== undefined && !(FIREWALL_ACTION_SCOPES as readonly unknown[]).includes(a.scope)) {
    out.push({ code: 'action.invalid', message: `scope must be one of ${FIREWALL_ACTION_SCOPES.join(', ')} when it is given (absent = both)` });
  }
  const ev = a.evidence;
  if (!isObject(ev) || typeof ev.boundToActor !== 'boolean' || !isNonNegInt(ev.minSignals)) {
    out.push({ code: 'action.invalid', message: 'evidence must be { boundToActor: boolean, minSignals: whole number, kinds? }' });
  } else {
    if (rung && FIREWALL_BOUND_EVIDENCE_RUNGS.includes(rung) && !ev.boundToActor) {
      out.push({ code: 'action.evidence_not_bound', message: `rung '${rung}' must rest on the actor's own signals (evidence.boundToActor, FWA-5)` });
    }
    if (ev.kinds !== undefined) {
      if (!Array.isArray(ev.kinds) || !ev.kinds.every((k) => typeof k === 'string')) out.push({ code: 'action.invalid', message: 'evidence.kinds must be a list of signal kinds' });
      else {
        const unknown = ev.kinds.filter((k) => !kinds.has(k as string));
        if (unknown.length) out.push({ code: 'action.unknown_evidence_kind', message: `evidence kind(s) ${unknown.join(', ')} are registered by no ai_firewall:signal contribution` });
      }
    }
  }
  return out;
}

function honeytokenProblems(h: unknown, moduleId: string, kinds: ReadonlyMap<string, RegisteredSignal>): Array<{ code: RegistryProblemCode; message: string }> {
  const out: Array<{ code: RegistryProblemCode; message: string }> = [];
  if (!isObject(h)) return [{ code: 'honeytoken.invalid', message: 'the declaration is not an object' }];
  const m = typeof h.id === 'string' ? OWNED_ID_RE.exec(h.id) : null;
  if (!m) out.push({ code: 'honeytoken.invalid', message: `id ${JSON.stringify(h.id)} must be '<module>.<decoy>' in lower case` });
  else if (m[1] !== moduleId) out.push({ code: 'honeytoken.foreign_id', message: `id '${h.id}' names module '${m[1]}', but '${moduleId}' registers it` });
  if (!['api_key', 'record', 'route', 'credential', 'other'].includes(h.kind as string)) out.push({ code: 'honeytoken.invalid', message: 'kind must be api_key, record, route, credential or other' });
  if (typeof h.labelKey !== 'string' || !h.labelKey) out.push({ code: 'honeytoken.invalid', message: 'labelKey must be a dictionary key' });
  if (h.plant !== undefined && !isFn(h.plant)) out.push({ code: 'honeytoken.invalid', message: 'plant must be a function' });
  if (h.remove !== undefined && !isFn(h.remove)) out.push({ code: 'honeytoken.invalid', message: 'remove must be a function' });
  if (h.descriptionKey !== undefined && (typeof h.descriptionKey !== 'string' || !h.descriptionKey)) out.push({ code: 'honeytoken.invalid', message: 'descriptionKey must be a dictionary key' });
  const kind = isObject(h.detector) && typeof h.detector.signalKind === 'string' && h.detector.signalKind ? h.detector.signalKind : null;
  if (!kind) out.push({ code: 'honeytoken.no_detector', message: 'no detector: a decoy nobody can see touched is no decoy (detector.signalKind)' });
  else if (!kinds.has(kind)) out.push({ code: 'honeytoken.unregistered_detector', message: `detector signal kind '${kind}' is registered by no ai_firewall:signal contribution` });
  // 02 §2.5: a touch is never legitimate, so its kind is critical (and a high-precision label for 03); a weaker one would hide the touch
  else if (kinds.get(kind)!.severity !== 'critical') {
    out.push({ code: 'honeytoken.detector_not_critical', message: `detector signal kind '${kind}' is registered with severity ${kinds.get(kind)!.severity}; a decoy's detector is critical` });
  }
  return out;
}

function analystProblems(a: unknown): Array<{ code: RegistryProblemCode; message: string }> {
  if (!isObject(a) || typeof a.key !== 'string' || !a.key) return [{ code: 'analyst.invalid', message: 'the analyst needs a key' }];
  const missing = ['available', 'triage', 'digest', 'toFilter'].filter((name) => !isFn(a[name]));
  return missing.length ? [{ code: 'analyst.invalid', message: `the analyst does not implement ${missing.join(', ')}` }] : [];
}

/** Every problem of the four registries, and the catalogue of what passed. Never throws. */
export function validateFirewallRegistries(input: RegistryInput): RegistryVerdict {
  const problems: RegistryProblem[] = [];
  const report = (point: FirewallPoint, contributionId: string, found: Array<{ code: RegistryProblemCode; message: string }>, id?: string) => {
    for (const f of found) problems.push({ point, contributionId, ...(id ? { id } : {}), code: f.code, message: f.message });
  };
  for (const f of input.failed) report(f.point, f.contributionId, [{ code: 'load_failed', message: `could not be loaded: ${f.message}` }]);

  /** The declarations of a catalog contribution, after its `metadata.ids` were compared with what it loaded. */
  const items = <T>(point: FirewallPoint, c: LoadedContribution, idOf: (item: unknown) => unknown): T[] => {
    const list = asList(c.impl);
    const loaded = list.map(idOf).map((v) => (typeof v === 'string' ? v : JSON.stringify(v)));
    if (!c.ids) report(point, c.contributionId, [{ code: 'ids_missing', message: `metadata.ids is missing: list the identities it registers (${loaded.join(', ')})` }]);
    else if (!sameSet(c.ids, loaded)) {
      report(point, c.contributionId, [{ code: 'ids_mismatch', message: `it registers ${loaded.join(', ') || 'nothing'}, but metadata.ids lists ${c.ids.join(', ') || 'nothing'}` }]);
    }
    return list as T[];
  };

  const signals = new Map<string, RegisteredSignal>();
  for (const c of input.signals) {
    for (const s of items<FirewallSignalContribution>(SIGNAL_POINT, c, (x) => (isObject(x) ? x.kind : x))) {
      const { problems: found, kind } = signalProblems(s);
      if (kind && signals.has(kind)) {
        found.push({ code: 'signal.duplicate', message: `kind '${kind}' is already registered by ${signals.get(kind)!.contributionId}` });
      }
      report(SIGNAL_POINT, c.contributionId, found, kind ?? undefined);
      if (kind && !found.length) signals.set(kind, { ...s, moduleId: c.moduleId, contributionId: c.contributionId });
    }
  }

  const actions = new Map<string, RegisteredAction>();
  for (const c of input.actions) {
    for (const a of items<FirewallActionContribution>(ACTION_POINT, c, (x) => (isObject(x) ? x.id : x))) {
      const found = actionProblems(a, c.moduleId, signals);
      const id = isObject(a) && typeof a.id === 'string' ? a.id : undefined;
      if (id && actions.has(id)) found.push({ code: 'action.duplicate', message: `action '${id}' is already registered by ${actions.get(id)!.contributionId}` });
      report(ACTION_POINT, c.contributionId, found, id);
      if (id && !found.length) actions.set(id, Object.assign(Object.create(Object.getPrototypeOf(a)) as object, a, { moduleId: c.moduleId, contributionId: c.contributionId }) as RegisteredAction);
    }
  }

  const honeytokens = new Map<string, RegisteredHoneytoken>();
  for (const c of input.honeytokens) {
    for (const h of items<HoneytokenContribution>(HONEYTOKEN_POINT, c, (x) => (isObject(x) ? x.id : x))) {
      const found = honeytokenProblems(h, c.moduleId, signals);
      const id = isObject(h) && typeof h.id === 'string' ? h.id : undefined;
      if (id && honeytokens.has(id)) found.push({ code: 'honeytoken.duplicate', message: `decoy '${id}' is already registered by ${honeytokens.get(id)!.contributionId}` });
      report(HONEYTOKEN_POINT, c.contributionId, found, id);
      if (id && !found.length) honeytokens.set(id, Object.assign(Object.create(Object.getPrototypeOf(h)) as object, h, { moduleId: c.moduleId, contributionId: c.contributionId }) as RegisteredHoneytoken);
    }
  }

  let analyst: Owned | null = null;
  if (input.analysts.length > 1) {
    const ids = input.analysts.map((c) => c.contributionId);
    for (const id of ids) {
      report(ANALYST_POINT, id, [{ code: 'analyst.more_than_one', message: `${ids.length} analysts are registered (${ids.join(', ')}); ai_firewall:analyst takes one. Remove all but one.` }]);
    }
  } else if (input.analysts.length === 1) {
    const c = input.analysts[0];
    const found = analystProblems(c.impl);
    report(ANALYST_POINT, c.contributionId, found);
    if (!found.length) analyst = { moduleId: c.moduleId, contributionId: c.contributionId };
  }

  return { ok: problems.length === 0, problems, catalog: { signals, actions, honeytokens, analyst } };
}

/** The refusal's text: counts and the first problems, never a value from a contribution beyond its ids. */
export function describeRegistryProblems(problems: readonly RegistryProblem[], named = 10): string {
  const head = problems.slice(0, named).map((p) => `${p.contributionId}${p.id ? ` [${p.id}]` : ''}: ${p.code}: ${p.message}`);
  const more = problems.length > named ? `; and ${problems.length - named} more` : '';
  return `ai_firewall registries refused (${problems.length} problem${problems.length === 1 ? '' : 's'}): ${head.join('; ')}${more}`;
}
