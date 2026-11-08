// Vendored from kui-react f7db139: modules/app/WidgetKit/templates/chart-area.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
import { seriesKind, seriesTemplate } from './series';
import type { SettingsTemplate } from '../settings/types';
import type { BuiltinKindSpec } from '../kind';

/** `chart.area`: bound series drawn as filled areas, overlaid or stacked. */
export const CHART_AREA: SettingsTemplate = seriesTemplate('area', 'Area chart');

export const CHART_AREA_KIND: BuiltinKindSpec = seriesKind(
  'area', CHART_AREA, 'Area chart', 'A bound series over time, drawn as a filled area.', 'fas fa-chart-area',
);
