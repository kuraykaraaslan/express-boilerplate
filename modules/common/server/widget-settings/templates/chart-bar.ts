// Vendored from kui-react f7db139: modules/app/WidgetKit/templates/chart-bar.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
import { seriesKind, seriesTemplate } from './series';
import type { SettingsTemplate } from '../settings/types';
import type { BuiltinKindSpec } from '../kind';

/** `chart.bar`: bound series drawn as grouped or stacked bars, vertical or horizontal. */
export const CHART_BAR: SettingsTemplate = seriesTemplate('bar', 'Bar chart');

export const CHART_BAR_KIND: BuiltinKindSpec = seriesKind(
  'bar', CHART_BAR, 'Bar chart', 'A bound series over time, drawn as bars.', 'fas fa-chart-column',
);
