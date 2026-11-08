// Pure (no imports): shared by the server catalog and the browser's widget grid.

/**
 * The component file each builtin type renders with (client side, `ui/data-widgets/`). The type's
 * SETTINGS come from its versioned template in kui-react WidgetKit (phase 21), not from this file.
 */
export const COMPONENT_FILE: Record<string, string> = {
  'chart.line': 'line-chart.component',
  'chart.bar': 'bar-chart.component',
  'chart.area': 'area-chart.component',
  'stat.value': 'stat-value.component',
  'progress': 'progress.component',
  'data.table': 'data-table.component',
  'gauge': 'gauge.component',
  'state': 'state.component',
  'map': 'map.component',
  'heatmap': 'heatmap.component',
  'stat.sparkline': 'stat-sparkline.component',
  'stat.attributes': 'stat-attributes.component',
  'data.feed': 'data-feed.component',
  'chart.pie': 'chart-pie.component',
  'chart.scatter': 'chart-scatter.component',
  'chart.histogram': 'chart-histogram.component',
  'content.markdown': 'content-markdown.component',
  'content.image': 'content-image.component',
  'content.links': 'content-links.component',
  'content.embed': 'content-embed.component',
  'control.button': 'control-button.component',
  'control.switch': 'control-switch.component',
  'control.slider': 'control-slider.component',
  'control.setpoint': 'control-setpoint.component',
  'viewer.model': 'viewer-model.component',
  'content.video': 'content-video.component',
  'control.form': 'control-form.component',
  'scada.symbol': 'scada-symbol.component',
  'scada.scene': 'scada-scene.component',
}

/** Every builtin's `componentId` starts with this (asserted in tests). */
export const BUILTIN_COMPONENT_PREFIX = 'dashboard/ui/data-widgets/'

const TYPE_BY_COMPONENT: Record<string, string> = Object.fromEntries(
  Object.entries(COMPONENT_FILE).map(([type, file]) => [`${BUILTIN_COMPONENT_PREFIX}${file}`, type]),
)

/** The builtin type a `componentId` renders (builtins and presets saved from them), if any. */
export const builtinTypeOfComponent = (componentId: string | null | undefined): string | undefined =>
  componentId ? TYPE_BY_COMPONENT[componentId] : undefined
