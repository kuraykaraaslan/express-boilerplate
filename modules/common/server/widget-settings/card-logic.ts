// Vendored from kui-react f7db139: modules/app/WidgetKit/card-logic.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
// The pure text logic of the widget card (no React): the "Updated …" footer text. `WidgetCard.tsx` draws the
// card; kui-ejs and KUInative vendor this file.

import { cssColor, fontStyle } from './settings/style';
import type { CardSettings } from './settings/types';

/** What the card body is showing. `unavailable`: the widget's provider cannot be shown. */
export type WidgetCardState = 'ready' | 'loading' | 'empty' | 'unconfigured' | 'error' | 'unavailable';

/** An inline style as a plain record (React's `CSSProperties` and the EJS partial's `style=""` are both made from it). */
export type StyleRecord = Record<string, string | number | undefined>;

export function formatUpdated(at: Date | string | number | null | undefined, mode: CardSettings['showUpdated'], locale?: string, now = Date.now()): string | null {
  if (!at || !mode || mode === 'off') return null;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  if (mode === 'relative') {
    const s = Math.round((now - d.getTime()) / 1000);
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    if (Math.abs(s) < 60) return rtf.format(-s, 'second');
    if (Math.abs(s) < 3600) return rtf.format(-Math.round(s / 60), 'minute');
    if (Math.abs(s) < 86400) return rtf.format(-Math.round(s / 3600), 'hour');
    return rtf.format(-Math.round(s / 86400), 'day');
  }
  const opts: Intl.DateTimeFormatOptions =
    mode === 'time' ? { hour: '2-digit', minute: '2-digit' }
      : mode === 'date' ? { day: 'numeric', month: 'short' }
        : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };
  return new Intl.DateTimeFormat(locale, opts).format(d);
}

const VARIANT: Record<NonNullable<CardSettings['variant']>, string> = {
  raised: 'bg-surface-raised border border-border shadow-sm',
  flat: 'bg-surface-base border border-border',
  outline: 'bg-transparent border border-border',
  plain: 'bg-transparent',
};

const SHADOW: Record<NonNullable<CardSettings['shadow']>, string> = {
  none: 'shadow-none',
  sm: 'shadow-sm',
  md: 'shadow-md',
  lg: 'shadow-lg',
};

const SIZES: Record<NonNullable<CardSettings['backgroundSize']>, string> = {
  cover: 'cover', contain: 'contain', fill: '100% 100%', auto: 'auto',
};

/** Only an https/http address or an internal path may become a CSS background image. */
export function safeImageUrl(url: unknown): string | undefined {
  if (typeof url !== 'string' || !url) return undefined;
  if (!/^(https?:\/\/|\/(?!\/))/i.test(url) || /["'()\\\s]/.test(url)) return undefined;
  return url;
}

/** The look of the frame's icon buttons (shared by the card's own buttons and a host's header buttons). */
export const ICON_BUTTON_CLASS = 'inline-flex h-7 w-7 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-overlay hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus disabled:opacity-50 disabled:cursor-not-allowed';

export interface CardModelInput {
  title?: string;
  card: CardSettings;
  state?: WidgetCardState;
  stale?: boolean;
  updatedAt?: Date | string | number | null;
  locale?: string;
  fixedHeight?: boolean;
  refreshing?: boolean;
  /** The caller draws extra header controls / badges / a footer of its own. */
  hasHeaderRight?: boolean;
  hasBadges?: boolean;
  hasFooter?: boolean;
  /** The caller gives the card a time window selector (shown when `card.showWindow` asks for it). */
  hasWindow?: boolean;
  /** Frame style the caller adds last (a `style` prop). */
  style?: StyleRecord;
  /** The "now" the relative "Updated …" text counts from. */
  now?: number;
}

/**
 * Every decision the widget card makes, as plain data: the frame's classes and style, whether and how the
 * header, body and footer show, and the card buttons. `WidgetCard.tsx` (React), kui-ejs's `WidgetCard.ejs` and
 * KUInative draw from it, so the three cannot disagree on what a `core:card` setting means.
 */
export function cardModel(i: CardModelInput) {
  const { card, title, locale } = i;
  const state = i.state ?? 'ready';
  const variant = card.variant ?? 'raised';
  const bgMode = card.background ?? 'default';
  const image = bgMode === 'image' ? safeImageUrl(card.backgroundImage) : undefined;
  const isUnavailable = state === 'unavailable';
  // An unavailable widget has no data to refresh, export or enlarge, and nothing to call old.
  const buttons = isUnavailable ? [] : card.buttons ?? [];
  const showTitle = card.showTitle !== false && !!title;
  // The card's own time window selector: asked for by the setting, given by the caller, and only on a card with data.
  const showWindow = card.showWindow === true && !!i.hasWindow && !isUnavailable;
  const staleMode = i.stale && !isUnavailable ? card.staleDisplay ?? 'badge' : null;
  const bodyState: WidgetCardState = staleMode === 'hide' ? 'empty' : state;
  const updated = isUnavailable ? null : formatUpdated(i.updatedAt, card.showUpdated, locale, i.now);

  const frame: StyleRecord = {
    borderRadius: typeof card.radius === 'number' ? card.radius : undefined,
    color: cssColor(card.textColor),
    ...(typeof card.borderWidth === 'number' ? { borderWidth: card.borderWidth, borderStyle: 'solid' } : {}),
    ...(cssColor(card.borderColor) ? { borderColor: cssColor(card.borderColor) } : {}),
    ...(bgMode === 'none' ? { background: 'transparent' } : {}),
    ...(bgMode === 'color' || bgMode === 'image' ? { backgroundColor: cssColor(card.backgroundColor) } : {}),
    ...(image ? { backgroundImage: `url("${image}")`, backgroundSize: SIZES[card.backgroundSize ?? 'cover'], backgroundPosition: 'center', backgroundRepeat: 'no-repeat' } : {}),
    ...(card.hideOnMobile || card.hideOnDesktop || card.mobileOrder !== undefined || card.mobileHeight !== undefined
      ? { '--wk-mo': card.mobileOrder ?? 'initial', '--wk-mh': card.mobileHeight ? `${card.mobileHeight}px` : 'auto' }
      : {}),
    ...i.style,
  };
  const pad = typeof card.padding === 'number' ? card.padding : 12;
  // The title row and footer keep readable side spacing even when the body has none (a map, a table).
  const chromePad = Math.max(pad, 12);
  const hasHeader = showTitle || showWindow || !!i.hasHeaderRight || !!i.hasBadges || buttons.length > 0 || staleMode !== null;
  // The shadow setting replaces the raised variant's own shadow (what tailwind-merge does in the React card).
  const variantClass = card.shadow && variant === 'raised' ? VARIANT.raised.replace(' shadow-sm', '') : VARIANT[variant];
  const sectionClass = [
    'group/wk relative flex h-full min-h-0 flex-col overflow-hidden rounded-xl text-text-primary',
    variantClass,
    card.shadow && SHADOW[card.shadow],
    staleMode === 'dim' && 'opacity-60',
    card.hideOnMobile && 'max-lg:hidden',
    card.hideOnDesktop && 'lg:hidden',
    card.mobileOrder !== undefined && 'max-lg:[order:var(--wk-mo)]',
    card.mobileHeight !== undefined && 'max-lg:[height:var(--wk-mh)]',
  ].filter(Boolean).join(' ');
  return {
    state, bodyState, buttons, showTitle, showWindow, staleMode, updated, frame, image, sectionClass, hasHeader,
    overlay: image && cssColor(card.overlayColor)
      ? { background: cssColor(card.overlayColor), backdropFilter: card.overlayBlur ? `blur(${card.overlayBlur}px)` : undefined } as StyleRecord
      : null,
    titleIcon: showTitle && card.titleIcon
      ? { name: card.titleIcon, size: card.titleIconSize ?? 16, color: cssColor(card.titleIconColor) }
      : null,
    titleStyle: fontStyle(card.titleFont, card.titleColor) as StyleRecord,
    subtitleStyle: { color: cssColor(card.subtitleColor) } as StyleRecord,
    headerStyle: { padding: `${Math.max(pad - 4, 8)}px ${chromePad}px ${pad === 0 ? 8 : 0}px` } as StyleRecord,
    bodyClass: ['relative @container min-h-0 flex-1 overflow-auto', i.fixedHeight && 'lg:[container-type:size]'].filter(Boolean).join(' '),
    bodyStyle: { padding: pad === 0 ? 0 : `${pad}px ${pad}px ${Math.max(pad, 16)}px` } as StyleRecord,
    footerStyle: { padding: `${pad === 0 ? 6 : 0}px ${chromePad}px ${Math.max(pad - 4, 8)}px` } as StyleRecord,
    showFooter: !!(updated || i.hasFooter),
    noDataText: card.noDataText,
    ariaBusy: state === 'loading' || i.refreshing ? true : undefined,
  };
}

/**
 * An inline style record as a `style=""` attribute value, the way React writes it: camelCase to kebab-case,
 * a bare number in pixels except for the properties that take none. Empty values drop out.
 */
const UNITLESS = new Set([
  'animationIterationCount', 'aspectRatio', 'borderImageOutset', 'borderImageSlice', 'borderImageWidth', 'columnCount', 'columns',
  'flex', 'flexGrow', 'flexPositive', 'flexShrink', 'flexNegative', 'flexOrder', 'fontWeight', 'gridArea', 'gridRow', 'gridRowEnd',
  'gridRowSpan', 'gridRowStart', 'gridColumn', 'gridColumnEnd', 'gridColumnSpan', 'gridColumnStart', 'lineClamp', 'WebkitLineClamp',
  'lineHeight', 'opacity', 'order', 'orphans', 'scale', 'tabSize', 'widows', 'zIndex', 'zoom',
  'fillOpacity', 'floodOpacity', 'stopOpacity', 'strokeDasharray', 'strokeDashoffset', 'strokeMiterlimit', 'strokeOpacity', 'strokeWidth',
]);
export function styleAttribute(style: StyleRecord | undefined): string {
  if (!style) return '';
  return Object.entries(style)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => {
      const name = k.startsWith('--') ? k : k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      const value = typeof v === 'number' && v !== 0 && !UNITLESS.has(k) && !k.startsWith('--') ? `${v}px` : String(v);
      return `${name}:${value}`;
    })
    .join(';');
}

/** The smallest a fitted view is drawn (`WidgetKindView.fit`): under it the body scrolls instead, so the text stays readable. */
export const MIN_FIT_SCALE = 0.6;

/** The scale that fits content `needed` px tall into `available` px: 1 when it fits (or nothing is measured yet), never under `MIN_FIT_SCALE`. */
export function fitScale(available: number, needed: number): number {
  if (!(available > 0) || !(needed > available)) return 1;
  return Math.max(MIN_FIT_SCALE, Math.floor((available / needed) * 1000) / 1000);
}
