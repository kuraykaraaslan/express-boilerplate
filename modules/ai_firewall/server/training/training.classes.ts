import type { LabelClass } from '../labels/ai_firewall.label-model';

/**
 * What each model learns from a label (docs/phases/55-ai-firewall/04-tree-models.md 4.1, D55-99). The label store's classes are the
 * detector ids of 02 plus `benign`, `honeytoken_touch` and `other` (03 §3.1, D55-75); the attack model's classes are the plan's (04,
 * "The split"). This file is the one place the two meet, as a table, so a new label class cannot slip into a model unmapped (the
 * table is a `Record` over every label class, and `training.classes.test.ts` pins it).
 */

/** The attack model's classes (04, "The split"), in the order the trainer lays its outputs out. */
export const ATTACK_MODEL_CLASSES = [
  'benign',
  'credential_attack',
  'enumeration',
  'injection_probe',
  'scraping_bot',
  'exfiltration',
  'session_hijack',
  'protocol_abuse',
] as const;
export type AttackModelClass = (typeof ATTACK_MODEL_CLASSES)[number];

/** The behaviour model's one output (binary: the probability that the actor behaves unlike itself). */
export const BEHAVIOUR_OUTPUT = 'anomalous';

/**
 * A label class as an attack model class, or null when the label says "an attack" but not which kind (the row is left out of the attack
 * dataset, counted `no_attack_class`, and still teaches the behaviour model).
 *
 * - `credential_stuffing`, `password_spray` → `credential_attack` (both guess credentials; the model need not tell them apart, the rules do);
 * - `public_bot` → `scraping_bot`; `signup_abuse` → `scraping_bot` (the probe lane's sign-up abuse is bulk scripted sign-ups);
 * - `data_exfiltration` → `exfiltration`; `enumeration`, `session_hijack` keep their names;
 * - `device_lane` → `protocol_abuse` (a device credential misused on the device protocols, 08; alerts only on those lanes, FWA-6);
 * - `admin_misuse` → none (an insider's behaviour, not a kind of traffic: the behaviour model's job);
 * - `api_key_abuse` → none (probing scopes, a new network, guessing keys: several kinds under one name);
 * - `honeytoken_touch`, `other` → none (an attack of unknown kind).
 * `injection_probe` has no label source yet (no detector and no probe suite names it): the class is in the plan and gets rows once one does.
 */
export const ATTACK_CLASS_OF_LABEL: Readonly<Record<LabelClass, AttackModelClass | null>> = Object.freeze({
  benign: 'benign',
  credential_stuffing: 'credential_attack',
  password_spray: 'credential_attack',
  enumeration: 'enumeration',
  session_hijack: 'session_hijack',
  data_exfiltration: 'exfiltration',
  admin_misuse: null,
  api_key_abuse: null,
  public_bot: 'scraping_bot',
  signup_abuse: 'scraping_bot',
  device_lane: 'protocol_abuse',
  honeytoken_touch: null,
  other: null,
});

/** The attack class of a label class (null: not in the attack dataset). */
export const attackClassOf = (labelClass: LabelClass): AttackModelClass | null => ATTACK_CLASS_OF_LABEL[labelClass] ?? null;

/** The behaviour model's target: 0 for `benign`, 1 for every other class (any attack, a decoy touch, `other`). */
export const behaviourTargetOf = (labelClass: LabelClass): 0 | 1 => (labelClass === 'benign' ? 0 : 1);
