import type {
  ActorKind,
  FirewallActionScope,
  FirewallMode,
  FirewallRung,
  PersonalDataClass,
  SignalAttrType,
  SignalLane,
  SignalOutcome,
  SignalSeverity,
} from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';
import type { Lane } from '@kuraykaraaslan-labs/common/server/lane.policy';

/**
 * What the catalogue pages read (docs/phases/55-ai-firewall/01 §1.8): the signal and action registries as the process loaded them, and
 * the tenant's own mode per action. Plain JSON, no functions: shared by the routes (`ai-firewall-signals.route.ts`,
 * `ai-firewall-actions.route.ts`) and the page (`ui/ai-firewall-catalogue.page.tsx`). The row types are type aliases, not interfaces: a
 * DataTable row must be assignable to `Record<string, unknown>`.
 */

/** The registry's verdict as the page shows it: the catalogue holds what passed; `problems` > 0 means the boot guard refused it. */
export interface RegistryStateView {
  ok: boolean;
  problems: number;
}

export type SignalAttributeView = {
  name: string;
  type: SignalAttrType;
  pd: PersonalDataClass;
};

export type SignalCatalogueEntry = {
  kind: string;
  /** The module that registers it. */
  moduleId: string;
  /** Dictionary key of its name (the owning module's dictionary); the page falls back to `kind`. */
  labelKey: string;
  lanes: readonly SignalLane[];
  actorKinds: readonly ActorKind[];
  /** null = any outcome. */
  outcomes: readonly SignalOutcome[] | null;
  severity: SignalSeverity;
  defaultWeight: number;
  attrs: SignalAttributeView[];
  /** Whether any attribute is about a person (a personal-data class other than `none`). */
  personalData: boolean;
};

export interface SignalCatalogue {
  registry: RegistryStateView;
  signals: SignalCatalogueEntry[];
}

/**
 * Whether the tenant may choose this action's mode (01 §1.8):
 *  - `yes`;
 *  - `platform_only`: it runs only as the platform, so its mode is the root tenant's (a customer tenant sees it, read only);
 *  - `tenant_only`: it runs only inside a tenant, never as the platform (the root tenant sees it, read only).
 */
export type ModeEditable = 'yes' | 'platform_only' | 'tenant_only';

export type ActionCatalogueEntry = {
  id: string;
  moduleId: string;
  labelKey: string;
  descriptionKey: string;
  rung: FirewallRung;
  /** The rung's place on the ladder (FIREWALL_RUNGS), weakest first: the sort order of the rung column. */
  rungOrder: number;
  lanes: readonly Lane[];
  actorKinds: readonly ActorKind[];
  ttl: { defaultMs: number; maxMs: number };
  minimumMode: 'suggest' | 'auto';
  hourlyBudget: number;
  evidence: { boundToActor: boolean; minSignals: number; kinds: readonly string[] | null };
  reversible: boolean;
  /** null = in a tenant and as the platform. */
  scope: FirewallActionScope | null;
  /** The tenant's own choice for this action, or null (the tenant's default mode applies). */
  chosen: FirewallMode | null;
  /**
   * The mode it runs under for this tenant right now: the choice (or the default), capped by `minimumMode`, observe while a kill switch
   * holds. null when the tenant cannot choose it (`editable` is not `yes`): the mode that applies is another place's.
   */
  effective: FirewallMode | null;
  editable: ModeEditable;
};

export interface ActionCatalogue {
  registry: RegistryStateView;
  /** The tenant's policy as the responder reads it (ai_firewall.settings-policy.ts). */
  policy: {
    /** Why every action is observed only, or null. `unreadable`: the settings could not be read, so the modes shown are not known. */
    killed: 'platform' | 'tenant' | 'unreadable' | null;
    defaultMode: 'observe' | 'suggest';
  };
  /** Whether the URL tenant is the root tenant (it sets the platform's modes and holds the platform's kill switch). */
  platform: boolean;
  /** The platform cap of any action's time limit (FIREWALL_ACTION_TTL_CAP_MS). */
  ttlCapMs: number;
  actions: ActionCatalogueEntry[];
}

/** What PUT /api/ai-firewall/actions answers. */
export interface ActionModeChange {
  actionId: string;
  /** null: back to the tenant's default mode. */
  chosen: FirewallMode | null;
  effective: FirewallMode;
  /** false when the value was already stored (nothing written, nothing audited). */
  changed: boolean;
}

/**
 * Whether a decoy is in place for the tenant (02 §2.5):
 *  - `planted`: its module answered its reference (and bait) for this tenant;
 *  - `passive`: it needs no planting (no `plant`; the module watches for it everywhere);
 *  - `not_planted`: its module has none for this tenant (no field key to derive it, or not for this tenant);
 *  - `failed`: its module could not answer (an error or no answer in time).
 */
export type HoneytokenState = 'planted' | 'passive' | 'not_planted' | 'failed';

export type HoneytokenCatalogueEntry = {
  id: string;
  moduleId: string;
  kind: 'api_key' | 'record' | 'route' | 'credential' | 'other';
  labelKey: string;
  descriptionKey: string | null;
  /** The detector's signal kind, and its name's dictionary key (the registering module's). */
  signalKind: string;
  signalLabelKey: string;
  state: HoneytokenState;
  /** Non-secret reference (a masked key, a record id, a count). */
  ref: string | null;
  /** The bait to place (the decoy key, the canary id, the trap paths); opens nothing. */
  bait: string | null;
  /** Where a touch is detected (an API path template), if the module says. */
  where: string | null;
};

/** The canary list (GET /api/ai-firewall/honeytokens): every registered decoy and its state for the URL tenant. */
export interface HoneytokenCatalogue {
  registry: RegistryStateView;
  decoys: HoneytokenCatalogueEntry[];
}
