// Vendored from kui-react f7db139: modules/app/WidgetKit/views/svg-node.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
// A tiny SVG element tree (pure data, no React, no DOM): the drawing the symbol, indicator and compass widgets
// decide on. The models return nodes, `SvgTree.tsx` draws them as React elements and `svgToString` writes them as
// markup for kui-ejs, so every platform draws exactly the same picture and a golden file can pin it as JSON.

export type SvgTag = 'svg' | 'g' | 'path' | 'rect' | 'circle' | 'ellipse' | 'line' | 'polygon' | 'text' | 'animate' | 'animateTransform';

export type SvgAttrValue = string | number;

export interface SvgNode {
  t: SvgTag;
  a?: Record<string, SvgAttrValue>;
  c?: SvgNode[];
  /** The text of a `text` node (escaped when written). */
  s?: string;
}

const TAGS: ReadonlySet<string> = new Set<SvgTag>(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polygon', 'text', 'animate', 'animateTransform']);
const ATTR_NAME = /^[a-zA-Z][a-zA-Z0-9:-]*$/;

/** Two decimals: the same text in every renderer (a float's tail must not reach a golden file). */
export const r2 = (n: number): number => Math.round(n * 100) / 100;

/** `node(tag, attrs, children)`: a shorthand the geometry builders use. */
export const el = (t: SvgTag, a?: Record<string, SvgAttrValue>, c?: SvgNode[]): SvgNode => ({ t, ...(a ? { a } : {}), ...(c && c.length ? { c } : {}) });

/** A text node: `text(x, y, 'Hello', { 'font-size': 10 })`. */
export const text = (x: number, y: number, s: string, a: Record<string, SvgAttrValue> = {}): SvgNode => ({ t: 'text', a: { x, y, ...a }, s });

const escapeText = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The markup of a node tree. An unknown tag or a malformed attribute name is dropped, never written. */
export function svgToString(node: SvgNode): string {
  if (!TAGS.has(node.t)) return '';
  const attrs = Object.entries(node.a ?? {})
    .filter(([k]) => ATTR_NAME.test(k))
    .map(([k, v]) => ` ${k}="${escapeAttr(String(v))}"`)
    .join('');
  const kids = node.s !== undefined ? escapeText(node.s) : (node.c ?? []).map(svgToString).join('');
  return kids ? `<${node.t}${attrs}>${kids}</${node.t}>` : `<${node.t}${attrs}/>`;
}

/** A symbol's turn (clockwise, in quarter turns of degrees) and whether it is flipped left to right. */
export type Orientation = 0 | 90 | 180 | 270;

/**
 * Turns and flips a drawing made for a `w` x `h` box. A quarter turn swaps the box's sides; the result says the
 * new box. The flip is applied first, inside the turn.
 */
export function orient(children: SvgNode[], w: number, h: number, turn: Orientation, mirror: boolean): { nodes: SvgNode[]; w: number; h: number } {
  let nodes = children;
  if (mirror) nodes = [el('g', { transform: `translate(${w} 0) scale(-1 1)` }, nodes)];
  if (turn === 0) return { nodes, w, h };
  if (turn === 90) return { nodes: [el('g', { transform: `translate(${h} 0) rotate(90)` }, nodes)], w: h, h: w };
  if (turn === 180) return { nodes: [el('g', { transform: `translate(${w} ${h}) rotate(180)` }, nodes)], w, h };
  return { nodes: [el('g', { transform: `translate(0 ${w}) rotate(270)` }, nodes)], w: h, h: w };
}

/** The arc of a circle from `from` to `to` degrees (0 = 3 o'clock, clockwise on screen, y down) as a path. */
export function arcPath(cx: number, cy: number, radius: number, from: number, to: number): string {
  const p = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return `${r2(cx + radius * Math.cos(a))} ${r2(cy + radius * Math.sin(a))}`;
  };
  const sweep = to >= from ? 1 : 0;
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  return `M${p(from)} A${radius} ${radius} 0 ${large} ${sweep} ${p(to)}`;
}

/** A point on a circle, `deg` as in `arcPath`. */
export const polar = (cx: number, cy: number, radius: number, deg: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [r2(cx + radius * Math.cos(a)), r2(cy + radius * Math.sin(a))];
};
