/**
 * Evasion, the training half (docs/phases/55-ai-firewall/04-tree-models.md 4.11; D55-121): the models lean on what an attacker cannot
 * shape. A client chooses its own user agent, headers, pacing, path shapes and parameter sizes for free, so those features are weighed
 * down when the models learn; what an attack cannot avoid (the accounts one address tries, the records it touches, the refusals it
 * earns, a run over sequential ids, sign-in failures, reads and exports far from the actor's own usual) keeps the full weight.
 *
 *   LightGBM (behaviour)  `feature_contri`: the split gain of each feature is multiplied by its weight (a shapeable feature must explain
 *                         twice as much to be chosen);
 *   XGBoost (attack)      `feature_weights` on the training matrix: the chance of a feature being drawn by the column sampling
 *                         (`colsample_bytree`) is proportional to its weight.
 *
 * Training only: the shipped model is an ordinary model of its library, read by the same evaluator; the weights are recorded in the meta's
 * `training` record. Pure.
 */
import type { ShippedModelName } from '../models/shipped-models.types';

/** The weight of a feature an attacker shapes for free. */
export const SHAPEABLE_WEIGHT = 0.5;

/** Features the attacker chooses itself (its client, its pacing, its paths): weighed down. */
export const SHAPEABLE_FEATURES: Readonly<Record<ShippedModelName, readonly string[]>> = {
  // The device tag is the user agent's: a stolen session's attacker can copy the victim's.
  behaviour: ['new_devices_today'],
  attack: [
    'ua_bot_ratio_5m', 'ua_script_ratio_5m', 'ua_empty_ratio_5m', 'ua_families_1h',
    'header_anomaly_ratio_5m', 'header_anomalies_mean_5m', 'timing_regular_ratio_5m', 'asset_ratio_5m',
    'path_entropy_mean_5m', 'params_mean_5m', 'param_bytes_mean_5m', 'payload_bytes_mean_5m',
  ],
};

/** Features an attack cannot avoid producing: full weight (named for the record and the tests; every unnamed feature is 1 too). */
export const HARD_TO_SHAPE_FEATURES: Readonly<Record<ShippedModelName, readonly string[]>> = {
  behaviour: [
    'distinct_subjects_24h_vs_usual', 'distinct_addresses_24h_vs_usual', 'export_bytes_24h_vs_usual', 'admin_actions_24h_vs_usual',
    'unusual_hour', 'new_countries_today', 'new_asns_today',
  ],
  attack: [
    'distinct_accounts_1h', 'distinct_accounts_24h', 'distinct_subjects_5m', 'sequential_id_steps_5m', 'auth_failures_1h',
    'auth_failure_ratio_5m', 'login_failures_1h', 'permission_denied_1h', 'status_401_ratio_5m', 'status_403_ratio_5m', 'status_404_ratio_5m',
  ],
};

/** One weight per feature in the model's order: SHAPEABLE_WEIGHT for a shapeable feature, 1 otherwise. */
export function featureWeights(model: ShippedModelName, names: readonly string[]): number[] {
  const shapeable = new Set(SHAPEABLE_FEATURES[model]);
  return names.map((n) => (shapeable.has(n) ? SHAPEABLE_WEIGHT : 1));
}

/** LightGBM's `feature_contri` value (comma-separated, the model's feature order). */
export const lightGbmFeatureContri = (names: readonly string[]): string => featureWeights('behaviour', names).join(',');

/** What the meta's training record says about the weights. */
export function evasionRecord(model: ShippedModelName, names: readonly string[]): { shapeable: string[]; weight: number } {
  const present = new Set(names);
  return { shapeable: SHAPEABLE_FEATURES[model].filter((n) => present.has(n)), weight: SHAPEABLE_WEIGHT };
}
