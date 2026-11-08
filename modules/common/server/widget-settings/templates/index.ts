// Vendored from kui-react f7db139: modules/app/WidgetKit/templates/index.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
// Every builtin widget type, pure data (safe for a server). Views are in ../views/index.ts.
import type { BuiltinKindSpec } from '../kind';
import type { SettingsTemplate } from '../settings/types';
import { CHART_LINE_KIND } from './chart-line';
import { CHART_BAR_KIND } from './chart-bar';
import { CHART_AREA_KIND } from './chart-area';
import { CHART_PIE_KIND } from './chart-pie';
import { CHART_SCATTER_KIND } from './chart-scatter';
import { CHART_HISTOGRAM_KIND } from './chart-histogram';
import { HEATMAP_KIND } from './heatmap';
import { STAT_VALUE_KIND } from './stat-value';
import { STAT_SPARKLINE_KIND } from './stat-sparkline';
import { STAT_ATTRIBUTES_KIND } from './stat-attributes';
import { PROGRESS_KIND } from './progress';
import { GAUGE_KIND } from './gauge';
import { STATE_KIND } from './state';
import { DATA_TABLE_KIND } from './data-table';
import { DATA_FEED_KIND } from './data-feed';
import { MAP_KIND } from './map';
import { VIEWER_MODEL_KIND } from './viewer-model';
import { CONTENT_MARKDOWN_KIND } from './content-markdown';
import { CONTENT_IMAGE_KIND } from './content-image';
import { CONTENT_LINKS_KIND } from './content-links';
import { CONTENT_EMBED_KIND } from './content-embed';
import { CONTENT_VIDEO_KIND } from './content-video';
import { CONTROL_BUTTON_KIND } from './control-button';
import { CONTROL_SWITCH_KIND } from './control-switch';
import { CONTROL_SLIDER_KIND } from './control-slider';
import { CONTROL_SETPOINT_KIND } from './control-setpoint';
import { CONTROL_FORM_KIND } from './control-form';
import { SCADA_SYMBOL_KIND } from './scada';
import { SCADA_SCENE_KIND } from './scada-scene';

export const BUILTIN_KINDS: readonly BuiltinKindSpec[] = [
  CHART_LINE_KIND,
  CHART_BAR_KIND,
  CHART_AREA_KIND,
  CHART_PIE_KIND,
  CHART_SCATTER_KIND,
  CHART_HISTOGRAM_KIND,
  HEATMAP_KIND,
  STAT_VALUE_KIND,
  STAT_SPARKLINE_KIND,
  STAT_ATTRIBUTES_KIND,
  PROGRESS_KIND,
  GAUGE_KIND,
  STATE_KIND,
  DATA_TABLE_KIND,
  DATA_FEED_KIND,
  MAP_KIND,
  VIEWER_MODEL_KIND,
  CONTENT_MARKDOWN_KIND,
  CONTENT_IMAGE_KIND,
  CONTENT_LINKS_KIND,
  CONTENT_EMBED_KIND,
  CONTENT_VIDEO_KIND,
  CONTROL_BUTTON_KIND,
  CONTROL_SWITCH_KIND,
  CONTROL_SLIDER_KIND,
  CONTROL_SETPOINT_KIND,
  CONTROL_FORM_KIND,
  SCADA_SYMBOL_KIND,
  SCADA_SCENE_KIND,
];

export const builtinKind = (type: string): BuiltinKindSpec | undefined => BUILTIN_KINDS.find((k) => k.type === type);

/** `builtin:<type>` → its current template. */
export const builtinTemplate = (type: string): SettingsTemplate | undefined => builtinKind(type)?.template;
