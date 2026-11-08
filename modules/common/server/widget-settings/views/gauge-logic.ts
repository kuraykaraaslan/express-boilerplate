// Vendored from kui-react f7db139: modules/app/WidgetKit/views/gauge-logic.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
// The pure logic of the gauge widget (no React): the scale, the colour ranges as bands, where the value sits against the
// scale and the props the gauge chart is drawn with. `GaugeView.tsx` draws it; kui-ejs and KUInative vendor this file.

import type { FontValue } from '../_app/SchemaForm/types';
import type { StyleRecord } from '../card-logic';
import type { SlotData } from '../kind';
import { cssColor, fontStyle, type ColorRange, type RangeEdges, type ValueFormat } from '../settings/style';

export type GaugeLayout = 'arc' | 'donut' | 'bar-horizontal' | 'bar-vertical' | 'level';
export type GaugeTone = 'success' | 'warning' | 'error' | 'info' | 'neutral';
export type GaugeBand = { from?: number; to: number; tone?: GaugeTone; color?: string; label?: string };

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

export type GaugeSettings = {
  layout?: GaugeLayout;
  label?: string;
  labelFont?: FontValue;
  labelColor?: string;
  icon?: string;
  iconColor?: string;
  iconSize?: number;
  iconBackground?: string;
  startAngle?: number;
  endAngle?: number;
  min?: number;
  max?: number;
  showMinMax?: boolean;
  minMaxFont?: FontValue;
  minMaxColor?: string;
  ticks?: number;
  tickLabels?: boolean;
  tickColor?: string;
  showValue?: boolean;
  valueFont?: FontValue;
  valueColor?: string;
  unitTitle?: string;
  needle?: boolean;
  needleStyle?: 'line' | 'arrow' | 'marker';
  needleColor?: string;
  barColorMode?: 'range' | 'constant';
  barColor?: string;
  trackColor?: string;
  thickness?: number;
  roundedCaps?: boolean;
  ranges?: unknown;
  rangeEdges?: RangeEdges;
  rangeDisplay?: 'outer' | 'track' | 'off';
  rangeOpacity?: number;
  animation?: boolean;
};

/** Colour ranges → gauge bands. An open lower end starts where the previous range ended; an open upper end runs to the top. */
export function rangesToBands(ranges: unknown): GaugeBand[] {
  if (!Array.isArray(ranges)) return [];
  const out: GaugeBand[] = [];
  for (const r of ranges as ColorRange[]) {
    const color = cssColor(r?.color);
    if (!r || typeof r !== 'object' || !color) continue;
    out.push({
      ...(typeof r.from === 'number' ? { from: r.from } : {}),
      to: typeof r.to === 'number' ? r.to : Number.POSITIVE_INFINITY,
      color,
      ...(r.label ? { label: r.label } : {}),
    });
  }
  return out;
}

/** Which side of its scale a value left it by: `null` while it is on the scale (both ends included) or there is no value. */
export type GaugeOffScale = 'below' | 'above' | null;

export function offScaleOf(value: number | null, min: number, max: number): GaugeOffScale {
  if (value === null || !Number.isFinite(value)) return null;
  return value > max ? 'above' : value < min ? 'below' : null;
}

/**
 * The value is further off the scale than the scale is wide (800 on 0 to 100): the scale, not the value, is likely wrong,
 * so a board being edited says where to set it. A value just past an end (105 on 0 to 100) is only marked.
 */
export function farOffScale(value: number | null, min: number, max: number): boolean {
  const side = offScaleOf(value, min, max);
  const span = max - min;
  if (!side || !(span > 0)) return false;
  return side === 'above' ? (value as number) - max > span : min - (value as number) > span;
}

/** Everything the gauge widget draws, decided once: the chart's props, with the formatting left to the caller. */
export function gaugeModel(s: GaugeSettings, format: ValueFormat, data: Record<string, SlotData | undefined>) {
  const value = num(data.value?.value);
  const min = num(data.min?.value) ?? num(s.min) ?? 0;
  const rawMax = num(data.max?.value) ?? num(s.max) ?? 100;
  const max = rawMax > min ? rawMax : min + 1;
  const scaleFormat = { ...format, unit: undefined };
  const byRange = (s.barColorMode ?? 'range') === 'range';
  const display = s.rangeDisplay ?? 'outer';
  const bands = !byRange && display === 'off' ? [] : rangesToBands(s.ranges);
  const customFont = !!s.valueFont && Object.keys(s.valueFont).length > 0;
  return {
    value, min, max, scaleFormat, bands, customFont,
    // A value off the scale is drawn at the scale's end and marked (the chart says which side); far off, an editor is told why.
    offScale: offScaleOf(value, min, max),
    farOffScale: farOffScale(value, min, max),
    head: {
      label: s.label ? { text: s.label, font: s.labelFont, color: s.labelColor } : null,
      tile: s.icon ? { name: s.icon, size: Math.round((s.iconSize ?? 20) * 1.8), color: s.iconColor, background: s.iconBackground } : null,
    },
    chart: {
      layout: s.layout ?? 'arc',
      bandEdges: s.rangeEdges ?? 'to',
      bandDisplay: byRange ? (display === 'off' ? 'bar' : 'both') : 'track',
      bandStyle: display === 'track' ? 'track' : 'outer',
      bandOpacity: Math.min(100, Math.max(0, s.rangeOpacity ?? 35)) / 100,
      label: s.unitTitle || undefined,
      needle: !!s.needle,
      needleStyle: s.needleStyle ?? 'line',
      needleColor: cssColor(s.needleColor),
      color: cssColor(s.barColor),
      trackColor: cssColor(s.trackColor),
      thickness: s.thickness ?? 14,
      roundedCaps: s.roundedCaps !== false,
      ticks: s.ticks ?? 0,
      tickLabels: !!s.tickLabels,
      tickColor: cssColor(s.tickColor),
      showMinMax: s.showMinMax !== false,
      showValue: s.showValue !== false,
      startAngle: s.startAngle ?? -135,
      endAngle: s.endAngle ?? 135,
      animate: s.animation !== false,
      scaleStyle: fontStyle(s.minMaxFont) as StyleRecord,
      scaleColor: cssColor(s.minMaxColor),
    },
    valueMetric: {
      text: (fmt: (v: number) => string) => (value === null ? '—' : fmt(value)),
      color: cssColor(s.valueColor),
      font: customFont ? s.valueFont : undefined,
      style: customFont && s.valueFont?.size ? undefined : { fontSize: '1em' } as StyleRecord,
    },
  };
}
