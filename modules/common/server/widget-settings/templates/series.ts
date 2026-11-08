// Vendored from kui-react f7db139: modules/app/WidgetKit/templates/series.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
// The one factory behind the time-series chart templates (chart.line, chart.bar, chart.area).
// Each preset is its own template id and version; they share the series repeater, the axis,
// legend, tooltip and threshold packs. Pure data.

import {
  axisFields, colorField, fontField, itemFormatFields, legendFields, minBelowMax, opt, since, thresholdsField, tooltipField,
} from '../settings/packs';
import type { SettingsTemplate, TemplateField, TemplateGroup } from '../settings/types';
import type { BuiltinKindSpec, SlotSpec } from '../kind';

export type SeriesPreset = 'line' | 'bar' | 'area';

/** Card buttons a series chart starts with: full screen and CSV download. */
export const SERIES_CARD_DEFAULTS = { buttons: ['fullscreen', 'export'] };

/** The repeatable series slot every series chart declares (`series`, `series#2` … `series#8`). */
export const SERIES_SLOT: SlotSpec = { key: 'series', label: 'Series', shape: 'series', required: true, repeatable: true };

const SHAPE_OPTIONS = [opt('circle', 'Circle'), opt('square', 'Square'), opt('diamond', 'Diamond'), opt('triangle', 'Triangle')];

const CURVE_OPTIONS = [
  opt('smooth', 'Smooth', 'line-smooth'),
  opt('linear', 'Straight', 'line-linear'),
  opt('step', 'Steps', 'line-step'),
];

/** Per-series styling: matched by series name (`*` = every series). */
export function seriesField(preset: SeriesPreset): TemplateField {
  const stroked = preset !== 'bar';
  return {
    since: 1,
    label: 'Series', type: 'repeater', group: 'series', max: 20,
    description: 'Style a series by its name; * matches every series and an exact name wins over *. ${name} in a label stands for the series\' own name.',
    fields: {
      key: { label: 'Series', type: 'data-key', slot: 'series', placeholder: '*', required: true },
      label: { label: 'Label', type: 'text', maxLength: 60, placeholder: '${name}' },
      color: { label: 'Colour', type: 'color', placeholder: 'Automatic' },
      ...itemFormatFields(),
      axis: {
        label: 'Value axis', type: 'select', display: 'segmented', value: 'left',
        options: [opt('left', 'Left'), opt('right', 'Right')],
        description: 'Put a series with another unit (e.g. % next to °C) on the right axis.',
      },
      ...(preset !== 'line' ? {
        stack: { label: 'Stack group', type: 'text', maxLength: 30, placeholder: 'Not stacked', description: 'Series with the same group stack on each other.' },
      } : {}),
      ...(stroked ? {
        lineStyle: {
          label: 'Line', type: 'select', display: 'segmented', value: 'solid',
          options: [opt('solid', 'Solid'), opt('dashed', 'Dashed'), opt('dotted', 'Dotted')],
        },
        width: { label: 'Line width (px)', type: 'number', nullable: true, display: 'input', min: 1, max: 8, placeholder: 'Chart width' },
        showPoints: {
          label: 'Points', type: 'select', display: 'segmented', value: '',
          options: [opt('', 'Chart setting'), opt('on', 'On'), opt('off', 'Off')],
        },
        pointShape: { label: 'Point shape', type: 'select', value: '', options: [opt('', 'Chart setting'), ...SHAPE_OPTIONS] },
        pointSize: { label: 'Point size (px)', type: 'number', nullable: true, display: 'input', min: 1, max: 12, placeholder: 'Chart size' },
        fill: {
          label: 'Fill', type: 'select', display: 'segmented', value: '',
          options: preset === 'area'
            ? [opt('', 'Chart setting'), opt('none', 'None'), opt('opacity', 'Flat'), opt('gradient', 'Gradient')]
            : [opt('', 'None'), opt('opacity', 'Flat'), opt('gradient', 'Gradient')],
        },
        fillOpacity: {
          label: 'Fill opacity', type: 'number', nullable: true, display: 'input', min: 0, max: 1, step: 0.05,
          placeholder: preset === 'area' ? 'Chart fill' : 'No fill',
        },
      } : {}),
      startHidden: { label: 'Hidden until clicked in the legend', type: 'boolean', value: false },
    },
  } as TemplateField;
}

const groupsFor = (preset: SeriesPreset): TemplateGroup[] => [
  { id: 'series', label: 'Series', tab: 'Display', since: 1 },
  preset === 'line' ? { id: 'lines', label: 'Lines', tab: 'Display', since: 1 }
    : preset === 'bar' ? { id: 'bars', label: 'Bars', tab: 'Display', since: 1 }
      : { id: 'area', label: 'Area', tab: 'Display', since: 1 },
  { id: 'labels', label: 'Value labels', tab: 'Display', since: 1 },
  { id: 'axis', label: 'Axis', tab: 'Display', since: 1 },
  { id: 'rightAxis', label: 'Right axis', tab: 'Display', since: 1 },
  { id: 'legend', label: 'Legend', tab: 'Display', since: 1 },
  { id: 'tooltip', label: 'Tooltip', tab: 'Display', since: 1 },
  { id: 'thresholds', label: 'Thresholds', tab: 'Display', since: 1 },
  { id: 'behaviour', label: 'Animation and zoom', tab: 'Display', since: 1 },
];

type Pack = Record<string, Omit<TemplateField, 'since'>>;

/** Value labels: on/off, where they sit, their font and colour. */
const labelFields = (preset: SeriesPreset): Pack => ({
  valueLabels: {
    label: 'Value labels', type: 'select', display: 'segmented', value: 'none', group: 'labels', required: true,
    options: [opt('none', 'Off'), opt('value', preset === 'bar' ? 'Value on each bar' : 'Value at the points')],
    description: 'Thinned automatically so labels never overlap.',
  },
  valueLabelPosition: {
    label: 'Position', type: 'select', display: 'segmented', group: 'labels', required: true, showIf: { valueLabels: 'value' },
    ...(preset === 'bar'
      ? { value: 'outside', options: [opt('outside', 'Past the end'), opt('inside', 'Inside the end'), opt('center', 'Centre')] }
      : { value: 'top', options: [opt('top', 'Above'), opt('bottom', 'Below')] }),
  },
  valueLabelFont: fontField('Label font', 'labels', { advanced: true, showIf: { valueLabels: 'value' } }),
  valueLabelColor: colorField('Label colour', 'labels', undefined, { advanced: true, showIf: { valueLabels: 'value' } }),
});

const presetFields = (preset: SeriesPreset): Pack => {
  if (preset === 'bar') {
    const bars: Pack = {
      xAxis: {
        label: 'One bar per', type: 'select', display: 'segmented', value: 'time', group: 'bars', required: true,
        options: [opt('time', 'Time step'), opt('category', 'Row of a table')],
        description: 'A row of a table: the latest value per entity (a device, a site, a status).',
      },
      categoryColumn: { label: 'Bar label column', type: 'data-key', slot: 'rows', group: 'bars', showIf: { xAxis: 'category' } },
      valueColumn: { label: 'Bar value column', type: 'data-key', slot: 'rows', group: 'bars', showIf: { xAxis: 'category' } },
      categorySort: {
        label: 'Order', type: 'select', display: 'segmented', value: 'none', group: 'bars', required: true, showIf: { xAxis: 'category' },
        options: [opt('none', 'As the rows come'), opt('desc', 'Largest first'), opt('asc', 'Smallest first')],
      },
      maxBars: { label: 'Most bars', type: 'number', min: 1, max: 100, value: 30, group: 'bars', advanced: true, showIf: { xAxis: 'category' } },
      stacked: { label: 'Stack the series', type: 'boolean', value: false, group: 'bars', showIf: { xAxis: 'time' } },
      orientation: {
        label: 'Bars', type: 'select', display: 'segmented', value: 'vertical', group: 'bars', required: true,
        options: [opt('vertical', 'Columns'), opt('horizontal', 'Horizontal bars')],
      },
      barWidth: { label: 'Bar width (% of the room for each bar)', type: 'number', min: 10, max: 100, step: 5, value: 70, group: 'bars' },
      barGap: { label: 'Gap between grouped bars (px)', type: 'number', min: 0, max: 16, value: 2, group: 'bars', advanced: true },
      barRadius: { label: 'Corner radius (px)', type: 'number', min: 0, max: 16, value: 4, group: 'bars', advanced: true },
    };
    return bars;
  }
  const g = preset === 'line' ? 'lines' : 'area';
  const stroke: Pack = {
    curve: { label: 'Line shape', type: 'select', display: 'cards', value: 'smooth', group: g, required: true, options: CURVE_OPTIONS },
    lineWidth: { label: 'Line width (px)', type: 'number', min: 1, max: 8, value: 2, group: g, advanced: true },
    showPoints: { label: 'Points on every value', type: 'boolean', value: false, group: g, advanced: true },
    pointShape: { label: 'Point shape', type: 'select', value: 'circle', group: g, advanced: true, required: true, options: SHAPE_OPTIONS },
    pointSize: { label: 'Point size (px)', type: 'number', nullable: true, display: 'input', min: 1, max: 12, placeholder: 'Line width + 1.5', group: g, advanced: true },
  };
  if (preset === 'line') return stroke;
  return {
    ...stroke,
    stacked: { label: 'Stack the series', type: 'boolean', value: false, group: 'area' },
    fill: {
      label: 'Fill', type: 'select', display: 'segmented', value: 'soft', group: 'area', required: true,
      options: [opt('none', 'None'), opt('soft', 'Soft'), opt('medium', 'Medium'), opt('solid', 'Strong')],
    },
    fillStyle: {
      label: 'Fill style', type: 'select', display: 'segmented', value: 'gradient', group: 'area', required: true,
      options: [opt('gradient', 'Fades to the baseline'), opt('opacity', 'Flat')],
    },
  };
};

/** Axis visibility, tick count and grid style beyond the shared axis pack. */
const axisExtraFields = (preset: SeriesPreset): Pack => ({
  ...(preset !== 'bar' ? {
    yFromZero: {
      label: 'Start the value axis at zero', type: 'boolean', value: preset === 'area', group: 'axis',
      description: 'Off: the axis spans just the data, so small changes show.',
    } as Omit<TemplateField, 'since'>,
  } : {}),
  showXAxis: { label: 'Category / time axis labels', type: 'boolean', value: true, group: 'axis' },
  showYAxis: { label: 'Value axis labels', type: 'boolean', value: true, group: 'axis' },
  xLabel: { label: 'X axis title', type: 'text', maxLength: 40, group: 'axis', advanced: true },
  yTickCount: { label: 'Value ticks (about)', type: 'number', nullable: true, display: 'input', min: 2, max: 10, placeholder: '4', group: 'axis', advanced: true },
  gridStyle: {
    label: 'Grid line', type: 'select', display: 'segmented', value: 'dashed', group: 'axis', advanced: true, required: true, showIf: { showGrid: true },
    options: [opt('dashed', 'Dashed'), opt('dotted', 'Dotted'), opt('solid', 'Solid')],
  },
});

/** The right value axis (used by series set to the right axis). */
const rightAxisFields = (): Pack => ({
  y2Label: { label: 'Right axis title', type: 'text', maxLength: 40, group: 'rightAxis', description: 'The right axis appears when a series is set to it (Series → Value axis).' },
  y2Min: { label: 'Right axis minimum', type: 'number', nullable: true, display: 'input', placeholder: 'From the data', group: 'rightAxis', advanced: true },
  y2Max: { label: 'Right axis maximum', type: 'number', nullable: true, display: 'input', placeholder: 'From the data', group: 'rightAxis', advanced: true },
});

/** Tooltip details beyond the mode. */
const tooltipExtraFields = (preset: SeriesPreset): Pack => ({
  tooltipTime: { label: 'Show the time or category', type: 'boolean', value: true, group: 'tooltip', advanced: true },
  tooltipDecimals: { label: 'Decimals in the tooltip', type: 'number', nullable: true, display: 'input', min: 0, max: 10, placeholder: 'As the series', group: 'tooltip', advanced: true },
  ...(preset !== 'line' ? {
    tooltipTotal: { label: 'Total row for stacked series', type: 'boolean', value: false, group: 'tooltip', advanced: true } as Omit<TemplateField, 'since'>,
  } : {}),
});

/** Thresholds: the shared pack plus the axis a line belongs to. */
const thresholdFields = (): Pack => {
  const pack = thresholdsField('thresholds');
  const t = pack.thresholds;
  return {
    thresholds: {
      ...t,
      fields: {
        ...t.fields,
        axis: { label: 'Axis', type: 'select', display: 'segmented', value: 'left', options: [opt('left', 'Left'), opt('right', 'Right')] },
      },
    },
  };
};

const behaviourFields = (preset: SeriesPreset): Pack => ({
  animate: { label: 'Animate on load', type: 'boolean', value: true, group: 'behaviour' },
  ...(preset !== 'bar' ? {
    zoom: {
      label: 'Drag to zoom the time axis', type: 'boolean', value: true, group: 'behaviour',
      description: 'Only for this viewer; double-click or "Reset zoom" leaves it. The board window does not change.',
    } as Omit<TemplateField, 'since'>,
  } : {}),
});

/** The settings template for one series preset. */
export function seriesTemplate(preset: SeriesPreset, label: string): SettingsTemplate {
  return {
    id: `builtin:chart.${preset}`,
    version: 1,
    namespace: '',
    label,
    format: true,
    exportable: true,
    cardDefaults: SERIES_CARD_DEFAULTS,
    formatDefaults: {},
    groups: groupsFor(preset),
    fields: {
      series: seriesField(preset),
      ...since(1, {
        ...presetFields(preset),
        ...labelFields(preset),
        ...axisFields('axis'),
        ...axisExtraFields(preset),
        ...rightAxisFields(),
        ...legendFields('legend', 'auto'),
        ...tooltipField('tooltip'),
        ...tooltipExtraFields(preset),
        ...thresholdFields(),
        ...behaviourFields(preset),
        defaultColor: colorField('Default colour', 'series', undefined, {
          advanced: true, description: 'Used for series without a colour of their own; empty = the theme palette.',
        }),
      }),
    },
    rules: [minBelowMax('yMin', 'yMax'), minBelowMax('y2Min', 'y2Max')],
    migrations: [],
  };
}

/** The catalog entry for one series preset. */
/** A bar chart is drawn from a time series or, in category mode, one bar per row of a table. */
const BAR_SLOTS: SlotSpec[] = [
  { ...SERIES_SLOT, required: false, anyOf: 'values' },
  { key: 'rows', label: 'Rows (one bar each)', shape: 'table', required: false, anyOf: 'values' },
];

export function seriesKind(preset: SeriesPreset, template: SettingsTemplate, label: string, description: string, icon: string): BuiltinKindSpec {
  return {
    type: `chart.${preset}`,
    label,
    category: 'Charts',
    description,
    icon,
    defaultW: 6,
    defaultH: 4,
    slots: preset === 'bar' ? BAR_SLOTS : [SERIES_SLOT],
    template,
  };
}
