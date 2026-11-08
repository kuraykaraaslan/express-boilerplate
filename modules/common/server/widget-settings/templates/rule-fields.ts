// Vendored from kui-react f7db139: modules/app/WidgetKit/templates/rule-fields.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
// The shared vocabulary of a rules repeater (the process diagram, the 3D viewer; pure): the operator words, the
// yes / no choice and the condition half of a rule row, so every kind with rules stores and edits the same keys and
// the rule engine (`views/scene-rules-logic.ts`) reads them all alike. A kind adds its own effect fields after them.

import type { FieldOption, FieldSchema } from '../_app/SchemaForm/types';
import { opt } from '../settings/packs';
import { RULE_OPS } from '../views/scene-rules-logic';

/** An effect that is a flag: unchanged, on or off. */
export const YES_NO: FieldOption[] = [opt('', 'No change'), opt('true', 'Yes'), opt('false', 'No')];

/** The operators of the rule engine, worded, after "always" (no operator). */
export const RULE_OP_OPTIONS: FieldOption[] = [
  opt('', 'Always'), opt('eq', 'equal to'), opt('ne', 'not equal to'), opt('gt', 'greater than'), opt('gte', 'greater than or equal to'),
  opt('lt', 'less than'), opt('lte', 'less than or equal to'), opt('between', 'between (inclusive)'), opt('in', 'one of (comma list)'),
  opt('set', 'set'), opt('unset', 'not set'), opt('true', 'true'), opt('false', 'false'),
];
if (RULE_OP_OPTIONS.length !== RULE_OPS.length + 1) throw new Error('rules: the operator options and the rule engine disagree');

const sourceOptions = () => [opt('column', 'A value of a symbol'), opt('param', 'A board parameter')];

/** The words that differ per kind of target (a symbol, a marker or a thing). */
export interface RuleTargetWords {
  /** The `target` field's placeholder, e.g. `pump1, a connection id or *`. */
  targetPlaceholder: string;
  /** What a target may be. */
  targetDescription: string;
  /** The `of` fields' placeholder: the target's own row. */
  ownRow: string;
  /** The `of` field's description: whose row else may be read. */
  otherRow: string;
  /** The first condition's key placeholder. Default: `value, status, mode`. */
  keyPlaceholder?: string;
}

/**
 * The condition half of a rule row: on / off, the target, two conditions (a value of a symbol or a board parameter,
 * an operator, a value and the upper end of "between") and their join. The same keys in every kind with rules.
 */
export function ruleConditionFields(words: RuleTargetWords): Record<string, FieldSchema> {
  return {
    enabled: { label: 'On', type: 'boolean', value: true },
    target: { label: 'Applies to', type: 'text', maxLength: 64, required: true, placeholder: words.targetPlaceholder, description: words.targetDescription },
    source: { label: 'When: read', type: 'select', value: 'column', options: sourceOptions() },
    key: { label: 'Value or parameter', type: 'text', maxLength: 64, placeholder: words.keyPlaceholder ?? 'value, status, mode' },
    of: { label: 'Of symbol', type: 'text', maxLength: 64, placeholder: words.ownRow, description: words.otherRow },
    op: { label: 'Is', type: 'select', options: RULE_OP_OPTIONS, description: 'Empty = the rule always applies.' },
    value: { label: 'Value', type: 'text', maxLength: 80, placeholder: '80, off, a,b,c' },
    to: { label: 'Up to', type: 'text', maxLength: 40, placeholder: 'Upper end of "between"' },
    join: { label: 'Join with', type: 'select', value: 'all', options: [opt('all', 'And (all hold)'), opt('any', 'Or (one holds)')] },
    source2: { label: 'And when: read', type: 'select', value: 'column', options: sourceOptions() },
    key2: { label: 'Value or parameter', type: 'text', maxLength: 64 },
    of2: { label: 'Of symbol', type: 'text', maxLength: 64, placeholder: words.ownRow },
    op2: { label: 'Is', type: 'select', options: RULE_OP_OPTIONS, description: 'Empty = no second condition.' },
    value2: { label: 'Value', type: 'text', maxLength: 80 },
    to2: { label: 'Up to', type: 'text', maxLength: 40 },
  };
}

/** The last field of every rule row: no later rule applies to the target once this one matched. */
export const stopField = (): FieldSchema => ({ label: 'Stop here', type: 'boolean', value: false, description: 'No later rule applies to this target once this one matched.' });
