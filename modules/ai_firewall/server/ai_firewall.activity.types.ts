/**
 * The AI firewall's activity page (Platform -> AI firewall, root super-admin): what `GET /api/ai-firewall/activity` returns, shared
 * by the route, the service and the page. One response holds everything the page shows (one request per page load; the page polls
 * it every 30 s while visible). Plain data only: this file is imported by the client bundle, so it imports types and nothing else.
 */
import type { ModelLoadFailure } from './models/shipped-models';
import type { ShippedModelName } from './models/shipped-models.types';
import type { CriterionStatus, GateCriterionId, GateVerdict } from './promotion/ai_firewall.promotion-model';
import type { DriftReport } from './promotion/ai_firewall.drift';

export type { ModelLoadFailure, ShippedModelName, CriterionStatus, GateCriterionId, DriftReport };

/** One cascade stage's shipped model: loaded with its facts, or off and why (loadShippedModel never throws; 04.5). */
export type ModelStatusView =
  | {
      readonly name: ShippedModelName;
      readonly state: 'loaded';
      readonly library: 'lightgbm' | 'xgboost';
      readonly libraryVersion: string;
      readonly trainedAt: string;
      readonly catalogue: string;
      readonly featureCount: number;
      readonly classes: readonly string[];
    }
  | {
      readonly name: ShippedModelName;
      readonly state: 'off';
      /** The library this stage needs (FWD-6), so the page can say what is missing. */
      readonly library: 'lightgbm' | 'xgboost';
      readonly reason: ModelLoadFailure;
      readonly detail: string;
    };

/**
 * How the request cascade runs (04.8): `off` with no model loaded (only the rule floor acts), `shadow` while it records what it would
 * do and allows every request (a model loaded but not both stages loaded and promoted), `enforcing` once both stages are loaded and
 * promoted (two keys, FWA-13).
 */
export type CascadeMode = 'off' | 'shadow' | 'enforcing';
/** `kill_switch`: both stages are promoted but a kill switch holds (or the policy cannot be read), so the cascade stays in shadow. */
export type CascadeModeReason = 'no_model' | 'one_stage' | 'not_promoted' | 'kill_switch' | 'promoted';
export type CascadeModeView = { readonly mode: CascadeMode; readonly reason: CascadeModeReason };

/** One criterion of the promotion gate as the page shows it (4.7). */
export type PromotionCriterionView = {
  readonly id: GateCriterionId;
  readonly status: CriterionStatus;
  readonly value: number | null;
  readonly target: number | null;
  readonly classes?: Readonly<Record<string, { labels: number; precision: number | null; recall: number | null; status: CriterionStatus }>>;
};

/**
 * One tree model's promotion state (4.6, 4.7, 4.9; FWD-12): shadow or promoted by the automatic gate, a ROOT owner's hold, the gate's last
 * verdict criterion by criterion, and the weekly drift report.
 */
export type ModelPromotionView = {
  readonly name: ShippedModelName;
  readonly state: 'shadow' | 'promoted';
  readonly held: boolean;
  readonly heldAt: string | null;
  /** The first 12 hex characters of the model file's sha256 the state is about; null when no model is loaded. */
  readonly sha: string | null;
  readonly shadowStartedAt: string | null;
  readonly shadowDays: number | null;
  readonly promotedAt: string | null;
  readonly demotedAt: string | null;
  /** The failing criteria of the last demotion (comma separated), or `model_changed`, `model_unloaded`, `held`. */
  readonly demotedReason: string | null;
  readonly lastEvaluatedAt: string | null;
  readonly verdict: {
    readonly at: string;
    readonly passed: boolean;
    readonly failing: readonly GateCriterionId[];
    readonly criteria: readonly PromotionCriterionView[];
    readonly metrics: GateVerdict['metrics'];
  } | null;
  readonly drift: DriftReport | null;
};

/** The count windows, newest first. */
export const ACTIVITY_WINDOWS = [
  { key: '15m', ms: 15 * 60 * 1000 },
  { key: '1h', ms: 60 * 60 * 1000 },
  { key: '24h', ms: 24 * 60 * 60 * 1000 },
] as const;
export type ActivityWindow = (typeof ACTIVITY_WINDOWS)[number]['key'];

/** How many of the newest security events and active bans the page shows, and how often it polls while visible. */
export const SECURITY_EVENTS_LIMIT = 50;
export const IP_BANS_LIMIT = 200;
export const ACTIVITY_POLL_MS = 30_000;
/**
 * How long the server keeps one read of the activity for every caller (single-flight: callers that arrive while a read runs share
 * it), so any number of open tabs costs one read of the audit logs and the ban store per period. A little under the poll interval,
 * so one tab still sees a fresh read on each poll.
 */
export const ACTIVITY_CACHE_MS = ACTIVITY_POLL_MS - 5_000;

/** One security action and how many audit rows of it every tenant wrote in each window. */
export type SecurityActionCount = {
  action: string;
  '15m': number;
  '1h': number;
  '24h': number;
};

/** One audit row of a security action, the safe fields only (no metadata, no user agent, no hashes). */
export type SecurityEventView = {
  id: string;
  createdAt: string;
  tenantId: string;
  tenantName: string;
  action: string;
  severity: string;
  actorType: string;
  actorId: string | null;
  ip: string | null;
  /** `resourceType:resourceId`, cut to a short length; null when the row names no resource. */
  target: string | null;
};

/** One active address ban (limiter IpStrikeService), times as ISO strings. */
export type IpBanView = {
  bucket: string;
  reason: string;
  offense: number;
  bannedAt: string;
  until: string;
  manual: boolean;
};

/** A part of the page read from a store that may be down: its data, or that it could not be read (the rest still shows). */
export type ActivitySection<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: 'unavailable' };

export type AiFirewallActivity = {
  generatedAt: string;
  models: ModelStatusView[];
  cascade: CascadeModeView;
  /** 4.7: the promotion store, one entry per model that has a state (none before the gate first ran). */
  promotion: ActivitySection<{ models: ModelPromotionView[] }>;
  security: ActivitySection<{
    /** The audit actions counted and listed, in a stable order. */
    actions: string[];
    counts: SecurityActionCount[];
    /** The newest security events across every tenant (at most SECURITY_EVENTS_LIMIT), newest first. */
    events: SecurityEventView[];
    /** Tenants whose audit log could not be read: left out of the counts and events, which cover the others. 0 when none. */
    skippedTenants: number;
  }>;
  /** `truncated`: the ban store's listing stopped at one of its bounds, so the list may be missing bans (an empty one included). */
  bans: ActivitySection<{ items: IpBanView[]; limit: number; truncated: boolean }>;
};
