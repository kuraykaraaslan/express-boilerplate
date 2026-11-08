// Vendored from kui-react f7db139: modules/app/WidgetKit/templates/chart-line.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
import { seriesKind, seriesTemplate } from './series';
import type { SettingsTemplate } from '../settings/types';
import type { BuiltinKindSpec } from '../kind';

/** `chart.line`: bound series drawn as lines (smooth, straight or steps). */
export const CHART_LINE: SettingsTemplate = seriesTemplate('line', 'Line chart');

export const CHART_LINE_KIND: BuiltinKindSpec = seriesKind(
  'line', CHART_LINE, 'Line chart', 'A bound series over time, drawn as a line.', 'fas fa-chart-line',
);
