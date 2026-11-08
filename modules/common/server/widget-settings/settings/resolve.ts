// Vendored from kui-react f7db139: modules/app/WidgetKit/settings/resolve.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
// Resolve one placement's effective settings from its layers (pure; server and browser).

import { CORE_CARD, CORE_FORMAT, boardCardLayer, platformCardDefaults } from './core';
import { effective, readSettings } from './engine';
import type { CardSettings, SettingsTemplate, Sparse, TemplateId, WidgetCaps } from './types';
import type { ValueFormat } from './style';
import { metaFormat, metaScaleDefaults, metaTypeDefaults, type ColumnMeta } from './source-meta';

export interface ResolvedPlacement {
  caps: WidgetCaps;
  card: CardSettings;
  format: ValueFormat;
  /** The widget type's own settings, defaults included. */
  settings: Sparse;
  /** Layers under the placement, per template (for the editor's defaults and the server's pruning). */
  layers: Partial<Record<TemplateId, Sparse>>;
  newer: Array<{ id: TemplateId; stored: number; known: number }>;
  templates: SettingsTemplate[];
}

export function capsOf(template: SettingsTemplate, slotCount: number): WidgetCaps {
  return { hasData: slotCount > 0, exportable: !!template.exportable, formatsNumbers: !!template.format };
}

/**
 * Layers, lowest first: template defaults < platform card defaults (by caps) < board card defaults
 * < the widget type's card/format defaults < the bound source's column meta < the definition's own defaults
 * (presets) < the placement.
 */
export function resolvePlacement(input: {
  template: SettingsTemplate;
  slotCount: number;
  settings: Sparse | null | undefined;
  board?: Sparse | null;
  /** A saved preset's or tenant definition's defaults (a settings-shaped object). */
  definitionDefaults?: Sparse | null;
  /** What the bound source says about its values: its unit, decimals, direction and declared range are the defaults. */
  sourceMeta?: ColumnMeta;
}): ResolvedPlacement {
  const { template, slotCount } = input;
  const caps = capsOf(template, slotCount);
  const templates = [template, CORE_CARD, ...(caps.formatsNumbers ? [CORE_FORMAT] : [])];
  const set = { type: template, card: CORE_CARD, format: caps.formatsNumbers ? CORE_FORMAT : undefined };
  const def = input.definitionDefaults ? readSettings(input.definitionDefaults, set).parts : {};
  const own = readSettings(input.settings, set);

  const cardLayer: Sparse = {
    ...platformCardDefaults(caps),
    ...boardCardLayer(input.board),
    ...(template.cardDefaults ?? {}),
    ...(def['core:card'] ?? {}),
  };
  const formatLayer: Sparse = { ...(template.formatDefaults ?? {}), ...metaFormat(input.sourceMeta), ...(def['core:format'] ?? {}) };
  const typeLayer: Sparse = {
    ...metaTypeDefaults(template.directionField, input.sourceMeta),
    ...metaScaleDefaults(template, input.sourceMeta),
    ...(def[template.id] ?? {}),
  };

  return {
    caps,
    card: effective(CORE_CARD, cardLayer, own.parts['core:card']) as CardSettings,
    format: (caps.formatsNumbers ? effective(CORE_FORMAT, formatLayer, own.parts['core:format']) : {}) as ValueFormat,
    settings: effective(template, typeLayer, own.parts[template.id]),
    layers: { 'core:card': cardLayer, 'core:format': formatLayer, [template.id]: typeLayer },
    newer: own.newer,
    templates,
  };
}

/** CSV text from rows; a cell that a spreadsheet would run as a formula is neutralised. */
export function toCsvText(rows: string[][]): string {
  const cell = (v: string) => {
    let s = v ?? '';
    if (/^[\s]*[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n');
}
