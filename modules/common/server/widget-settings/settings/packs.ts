// Vendored from kui-react f7db139: modules/app/WidgetKit/settings/packs.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
// Reusable field packs: the same sub-structure (value font, colour ranges, legend, axis,
// thresholds, icon, layout) means the same keys and the same editor in every widget type.

import type { FieldOption } from '../_app/SchemaForm/types';
import type { TemplateField } from './types';

type F = Omit<TemplateField, 'since'>;
type Pack = Record<string, F>;

/** Stamp `since` on a whole field map (every field of a v1 template is `since: 1`). */
export function since(version: number, fields: Pack): Record<string, TemplateField> {
  const out: Record<string, TemplateField> = {};
  for (const [k, f] of Object.entries(fields)) out[k] = { ...f, since: version };
  return out;
}

export const opt = (value: string, label: string, preview?: string): FieldOption =>
  preview ? { value, label, preview } : { value, label };

export const colorField = (label: string, group: string, value?: string, extra: Partial<F> = {}): F =>
  ({ label, type: 'color', group, ...(value !== undefined ? { value } : {}), ...extra });

export const fontField = (label: string, group: string, extra: Partial<F> = {}): F =>
  ({ label, type: 'font', group, ...extra });

/** A layout variant, picked from picture cards. The first option is the default. */
export const layoutField = (options: FieldOption[], group = 'layout'): F => ({
  label: 'Layout', type: 'select', display: 'cards', group, required: true,
  value: typeof options[0] === 'string' ? options[0] : options[0].value, options,
});

/** Font + colour for the main number. */
export const valueStyleFields = (group = 'value', color = 'var(--text-primary)'): Pack => ({
  valueFont: fontField('Value font', group),
  valueColor: colorField('Value colour', group, color),
});

/** Font + colour for a secondary label. */
export const labelStyleFields = (group = 'label', color = 'var(--text-secondary)'): Pack => ({
  labelFont: fontField('Label font', group, { advanced: true }),
  labelColor: colorField('Label colour', group, color, { advanced: true }),
});

/** Colour ranges on the raw value: the first range the value falls in colours it. */
export const rangesFields = (description: string, group = 'colour'): Pack => ({
  ranges: {
    label: 'Colour ranges', type: 'repeater', group, max: 20, description,
    fields: {
      from: { label: 'From', type: 'number', nullable: true, display: 'input', placeholder: 'open' },
      to: { label: 'To', type: 'number', nullable: true, display: 'input', placeholder: 'open' },
      color: { label: 'Colour', type: 'color', required: true, value: 'var(--success)' },
      label: { label: 'Label', type: 'text', maxLength: 40, placeholder: 'High' },
    },
  },
  rangeEdges: {
    label: 'A value exactly on a boundary belongs to', type: 'select', display: 'segmented', value: 'from', group, advanced: true,
    options: [opt('from', 'The range starting there'), opt('to', 'The range ending there')],
  },
});

export const legendFields = (group = 'legend', value = 'auto', withValues = true): Pack => ({
  legend: {
    label: 'Legend', type: 'select', group, value, required: true,
    options: [opt('auto', 'When there are 2 or more'), opt('top', 'Top'), opt('bottom', 'Bottom'), opt('left', 'Left'), opt('right', 'Right'), opt('none', 'Off')],
  },
  ...(withValues ? {
    legendValues: {
      label: 'Values in the legend', type: 'multi-select', group, value: [], advanced: true,
      options: [opt('latest', 'Latest'), opt('min', 'Minimum'), opt('max', 'Maximum'), opt('avg', 'Average'), opt('total', 'Total')],
    } as F,
  } : {}),
  legendFont: fontField('Legend font', group, { advanced: true }),
  legendColor: colorField('Legend text colour', group, undefined, { advanced: true }),
});

export const axisFields = (group = 'axis', withX = false): Pack => ({
  showGrid: { label: 'Grid lines', type: 'boolean', value: true, group },
  gridColor: colorField('Grid colour', group, undefined, { advanced: true, showIf: { showGrid: true } }),
  yMin: { label: 'Y minimum', type: 'number', nullable: true, display: 'input', placeholder: 'From the data', group, advanced: true },
  yMax: { label: 'Y maximum', type: 'number', nullable: true, display: 'input', placeholder: 'From the data', group, advanced: true },
  yLabel: { label: 'Y axis title', type: 'text', maxLength: 40, group, advanced: true },
  ...(withX ? {
    xMin: { label: 'X minimum', type: 'number', nullable: true, display: 'input', placeholder: 'From the data', group, advanced: true } as F,
    xMax: { label: 'X maximum', type: 'number', nullable: true, display: 'input', placeholder: 'From the data', group, advanced: true } as F,
    xLabel: { label: 'X axis title', type: 'text', maxLength: 40, group, advanced: true } as F,
  } : {}),
  tickFont: fontField('Axis label font', group, { advanced: true }),
  tickColor: colorField('Axis label colour', group, undefined, { advanced: true }),
});

export const thresholdsField = (group = 'thresholds'): Pack => ({
  thresholds: {
    label: 'Threshold lines', type: 'repeater', group, max: 10, advanced: true,
    description: 'A horizontal line at a fixed value, e.g. a limit or a target.',
    fields: {
      value: { label: 'Value', type: 'number', display: 'input', required: true },
      label: { label: 'Label', type: 'text', maxLength: 40, placeholder: 'Limit' },
      color: { label: 'Colour', type: 'color', value: 'var(--warning)' },
      style: { label: 'Line', type: 'select', display: 'segmented', value: 'dashed', options: [opt('solid', 'Solid'), opt('dashed', 'Dashed'), opt('dotted', 'Dotted')] },
      width: { label: 'Width (px)', type: 'number', min: 1, max: 8, value: 1 },
    },
  },
});

export const iconFields = (group = 'icon', color = 'var(--primary)', size = 24): Pack => ({
  icon: { label: 'Icon', type: 'icon', group, placeholder: 'fas fa-bolt' },
  iconColor: colorField('Icon colour', group, color, { advanced: true }),
  iconSize: { label: 'Icon size (px)', type: 'number', min: 8, max: 128, value: size, group, advanced: true },
});

export const tooltipField = (group = 'tooltip'): Pack => ({
  tooltip: {
    label: 'Tooltip', type: 'select', display: 'segmented', value: 'axis', group, required: true,
    options: [opt('axis', 'All series'), opt('point', 'Nearest point'), opt('none', 'Off')],
  },
});

export const dateDisplayField = (label: string, group: string, value = 'relative'): F => ({
  label, type: 'select', group, value, required: true,
  options: [opt('relative', '2 min ago'), opt('time', '14:05'), opt('date', '15 Oct'), opt('datetime', '15 Oct 14:05')],
});

/** Per-item value format override (a series, a column, a record field): empty = the widget's. */
export const itemFormatFields = (): Pack => ({
  unit: { label: 'Unit', type: 'text', maxLength: 16, placeholder: 'Widget unit' },
  decimals: { label: 'Decimals', type: 'number', nullable: true, display: 'input', min: 0, max: 10, placeholder: 'Widget decimals' },
});

export const disableWhenField = (group = 'safety'): F => ({
  label: 'Disable the control when', type: 'multi-select', group, value: ['stale'],
  options: [opt('stale', 'The reading is old'), opt('unknown', 'The state is unknown')],
  description: 'The reason is shown in a tooltip. The command still checks everything on the server.',
});

/** `min < max` when both are set. */
export const minBelowMax = (minKey: string, maxKey: string) => (v: Record<string, unknown>) =>
  typeof v[minKey] === 'number' && typeof v[maxKey] === 'number' && (v[minKey] as number) >= (v[maxKey] as number)
    ? [{ path: maxKey, message: 'Maximum must be greater than minimum', code: 'minBelowMax' as const }]
    : [];
