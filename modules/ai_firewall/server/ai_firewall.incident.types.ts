import type { IncidentStatus } from './store/ai_firewall.store';
import type {
  DetectionSummaries, HistoryEntry, IncidentExplanation, IncidentModels, IncidentSeverity,
} from './incidents/ai_firewall.incident-model';
import type { IncidentLabel } from './labels/ai_firewall.label-model';

/**
 * What the incident pages read (docs/phases/55-ai-firewall/02 §2.4): the list, one incident with its timeline, and an actor's view.
 * Plain JSON, no functions: shared by the routes (`ai-firewall-incidents.route.ts`, `ai-firewall-incident.route.ts`,
 * `ai-firewall-actor.route.ts`), the service and the page (`ui/ai-firewall-incidents.page.tsx`). Row types are type aliases: a DataTable
 * row must be assignable to `Record<string, unknown>`.
 */

/** Most incidents a list answers (the newest by last activity); `truncated` says there are more. */
export const INCIDENT_LIST_MAX = 500;
/** Most events a timeline or an actor view answers (the newest). */
export const TIMELINE_EVENTS_MAX = 200;
/** Most incidents an actor view answers. */
export const ACTOR_INCIDENTS_MAX = 100;
/** How far before an incident opened its timeline starts (the lead-up). */
export const TIMELINE_LEAD_MS = 60 * 60 * 1000;
/** How far back an actor view reads the actor's events (never past the tenant's retention, which deletes them). */
export const ACTOR_EVENTS_DAYS = 7;

export type IncidentRow = {
  incidentId: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  actorKind: string;
  actorId: string;
  lane: string;
  score: number | null;
  peakScore: number | null;
  /** `detector.<id>` or `score.rules`. */
  reason: string | null;
  /** The detectors that held at least once, strongest first. */
  detectors: string[];
  openedAt: string;
  lastSignalAt: string;
  closedAt: string | null;
  closeReason: string | null;
  acknowledgedAt: string | null;
  platform: boolean;
  alertsOnly: boolean;
  scorings: number;
  /** 04.6: the tree models' peak scores in shadow (0..100), null for a model that never scored the actor. */
  models: { behaviour: number | null; attack: number | null; attackClass: string | null };
};

export type IncidentList = {
  /** The root tenant's list: the platform's incidents (addresses, anonymous callers, root actors). */
  platform: boolean;
  incidents: IncidentRow[];
  truncated: boolean;
};

export type TimelineEvent = {
  signalId: string;
  at: string;
  kind: string;
  /** Dictionary key of the kind's name (the registering module's); the page falls back to `kind`. */
  labelKey: string;
  outcome: string;
  severity: string;
  lane: string;
  source: string;
  subjectType: string | null;
  /**
   * The address the event carried (for a person or a key), in the actor view only (`ai_firewall.events.read`); null in an incident's
   * timeline (`ai_firewall.incidents.read` does not open addresses, D55-40), for an address actor (it is the actor) or when none.
   */
  ip: string | null;
};

export type IncidentDetail = {
  incident: IncidentRow & {
    closedBy: string | null;
    acknowledgedBy: string | null;
    coldStart: boolean;
    detections: DetectionSummaries;
    explanation: IncidentExplanation | null;
    history: HistoryEntry[];
    /** 04.6: what the tree models said in shadow (their latest and peak scores, the peak's contributions, the days they flagged). */
    modelTracks: IncidentModels | null;
  };
  /** The actor's stored events from an hour before it opened to its last activity, newest first. */
  events: TimelineEvent[];
  eventsTruncated: boolean;
  /** The events above by kind. */
  kinds: Record<string, number>;
  /** A person's verdict on the incident (03 §3.2): its label of source admin, or null when nobody labelled it yet. */
  label: IncidentLabel | null;
};

export type ActorView = {
  actor: { kind: string; id: string };
  incidents: IncidentRow[];
  /** The actor's stored events of the last ACTOR_EVENTS_DAYS days, newest first. */
  events: TimelineEvent[];
  eventsTruncated: boolean;
  kinds: Record<string, number>;
};

export type IncidentChangeResult = {
  incident: IncidentRow;
  changed: boolean;
  /**
   * The incident's label when the change wrote or withdrew it (03 §3.2): a false alarm writes the false-positive label, a reopen of a false
   * alarm withdraws it (null); absent when the change left the label as it was.
   */
  label?: IncidentLabel | null;
};

/** PUT /api/ai-firewall/incidents/[incidentId]/label: the incident's label as it stands, and whether this call changed it. */
export type IncidentLabelResult = {
  label: IncidentLabel;
  changed: boolean;
};
