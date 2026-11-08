import { createHmac } from 'node:crypto';
import { parse, type Node } from 'acorn';
import { ancestor } from 'acorn-walk';

/**
 * The mark of a protected pack (dashboard phase 33, ADR-0016, P5 and C4): every download carries a pattern of its own in the numbers
 * of the pack's code, so a copy that turns up elsewhere says which download it came from.
 *
 * - **What is marked** (`markableLiterals`, run once at build time on the final code): every decimal in the numeric attributes of a
 *   picture held in a string (a thumbnail, a preview: `x`, `d`, `points`, ...), and every non-integer numeric literal, moved by a
 *   fraction of its last printed digit (`decimalShift` 1: `2.5` by 0.01, `0.45` by 0.001; 2 for metres: `1.2` by 1 mm), and every
 *   integer that is the value of a geometry property of
 *   an object literal (`x`, `y`, `width`, `r`, ...; not 0), moved by the pack's `integerStep` (0.01 of a 100-unit SCADA box, 0.1 mm of
 *   a 3D item). Nothing else: an integer used as a count or an index never changes, so the code behaves as before; a change of that
 *   size is not visible in a drawing.
 * - **The pattern** (`markTrits`): HMAC-SHA-256 of the mark id gives one of -1, 0, +1 per marked literal, in order.
 * - **Serving** (`applyMark`): the stored list of literals is rewritten from the end, so offsets stay valid; no parse per request.
 * - **Reading a copy** (`readMarkTrits`, `scoreMark`): the copy's literals are parsed the same way and compared with the build's, one
 *   by one; each logged mark is scored by how many of the readable literals agree with its pattern.
 */

export interface MarkableLiteral {
  /** Offsets of the literal's text in the built code. */
  start: number;
  end: number;
  /** Its value in the built code. */
  value: number;
  /** How far one step of the mark moves it. */
  step: number;
}

/** Object properties whose integer values are geometry (SVG attributes, the parts of a 3D item). */
export const GEOMETRY_KEYS: ReadonlySet<string> = new Set([
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'w', 'd', 'h', 'z0', 'z1',
]);

/** The numeric attributes of picture markup whose decimals the mark moves. */
const SVG_NUMERIC_ATTRS: ReadonlySet<string> = new Set([
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'd', 'points', 'stroke-width', 'opacity',
  'fill-opacity', 'stroke-opacity', 'font-size',
]);

/** The length of the escape sequence at `i` of a string literal's text (`\x22`, `\u0022`, `\"`), or 0 when there is none. */
function escapeAt(raw: string, i: number): number {
  if (raw[i] !== '\\') return 0;
  if (raw[i + 1] === 'x') return 4;
  if (raw[i + 1] === 'u') return raw[i + 2] === '{' ? raw.indexOf('}', i) - i + 1 : 6;
  return 2;
}

/** The character an escape at `i` stands for (only the ones markup uses: a quote, a space). */
function escaped(raw: string, i: number, len: number): string {
  const body = raw.slice(i + 2, i + len).replace(/[{}]/g, '');
  if (raw[i + 1] === 'x' || raw[i + 1] === 'u') return String.fromCharCode(parseInt(body, 16));
  return raw[i + 1]!;
}

/**
 * Every decimal inside the numeric attributes of the picture markup in a string literal's text, with its offset in that text. The
 * text is read as written: an obfuscator writes a quote as `\x22` and a space as `\x20`, so escapes are stepped over, never read as
 * digits.
 */
function* svgDecimals(raw: string): Generator<{ at: number; text: string }> {
  // the literal's characters, each with where it starts in the text
  const chars: { c: string; at: number }[] = [];
  for (let i = 1; i < raw.length - 1;) {
    const len = escapeAt(raw, i);
    if (len > 0) { chars.push({ c: escaped(raw, i, len), at: -1 }); i += len; } else { chars.push({ c: raw[i]!, at: i }); i += 1; }
  }
  const text = chars.map((x) => x.c).join('');
  const attr = /(?<![\w-])([a-z][a-z0-9-]*)="([^"]*)"/g;
  for (const m of text.matchAll(attr)) {
    if (!SVG_NUMERIC_ATTRS.has(m[1]!)) continue;
    const valueAt = m.index! + m[0].length - m[2]!.length - 1;
    for (const d of m[2]!.matchAll(/(?<![\d.])\d+\.\d+(?![\d.])/g)) {
      const first = chars[valueAt + d.index!]!;
      const last = chars[valueAt + d.index! + d[0].length - 1]!;
      // a number written through an escape is left alone: its text is not the digits
      if (first.at < 0 || last.at < 0 || last.at - first.at !== d[0].length - 1) continue;
      yield { at: first.at, text: d[0] };
    }
  }
}

/** Decimals printed in a numeric literal's source text (`2.50` -> 2, `.5` -> 1); null for an exponent or a non-decimal form. */
function decimalsOf(raw: string): number | null {
  if (/[eExXoObB_n]/.test(raw)) return null;
  const dot = raw.indexOf('.');
  return dot < 0 ? 0 : raw.length - dot - 1;
}

function propertyKey(node: Node): string | null {
  const p = node as unknown as { type: string; computed?: boolean; key?: { type: string; name?: string; value?: unknown } };
  if (p.type !== 'Property' || p.computed || !p.key) return null;
  if (p.key.type === 'Identifier') return p.key.name ?? null;
  if (p.key.type === 'Literal' && typeof p.key.value === 'string') return p.key.value;
  return null;
}

/** How a pack is marked: the step of an integer geometry value (0 = none) and how many digits past a decimal's last one it moves. */
export interface MarkPolicy {
  integerStep: number;
  decimalShift: number;
}

/** The literals of `code` the mark may move, in source order (see the header). */
export function markableLiterals(code: string, { integerStep, decimalShift }: MarkPolicy): MarkableLiteral[] {
  const ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
  const out: MarkableLiteral[] = [];
  ancestor(ast, {
    Literal(node, _state, ancestors) {
      const lit = node as unknown as { start: number; end: number; value: unknown; raw?: string };
      if (typeof lit.value === 'string' && lit.raw !== undefined && lit.value.includes('<svg')) {
        // a picture in a string (a thumbnail, a preview): every decimal of its markup, found in the literal's own text
        for (const d of svgDecimals(lit.raw)) {
          const decimals = d.text.length - d.text.indexOf('.') - 1;
          if (decimals > 12) continue;
          const at = lit.start + d.at;
          out.push({ start: at, end: at + d.text.length, value: Number(d.text), step: 10 ** -(decimals + decimalShift) });
        }
        return;
      }
      if (typeof lit.value !== 'number' || !Number.isFinite(lit.value) || lit.raw === undefined) return;
      const parent = ancestors[ancestors.length - 2];
      // a property key (`{ 1.5: x }`) is a name, not a number
      if (parent && (parent as unknown as { key?: unknown }).key === node) return;
      if (Number.isInteger(lit.value)) {
        if (integerStep <= 0 || lit.value === 0) return;
        const key = parent ? propertyKey(parent) : null;
        if (key === null || !GEOMETRY_KEYS.has(key) || (parent as unknown as { value?: unknown }).value !== node) return;
        out.push({ start: lit.start, end: lit.end, value: lit.value, step: integerStep });
        return;
      }
      const decimals = decimalsOf(lit.raw);
      if (decimals === null || decimals === 0 || decimals > 12) return;
      out.push({ start: lit.start, end: lit.end, value: lit.value, step: 10 ** -(decimals + decimalShift) });
    },
  });
  return out.sort((a, b) => a.start - b.start);
}

/** The pattern of a mark: one of -1, 0, +1 per literal, from HMAC-SHA-256 of the mark id (counter blocks). */
export function markTrits(markId: string, count: number): number[] {
  const out: number[] = [];
  for (let block = 0; out.length < count; block++) {
    const bytes = createHmac('sha256', `kui-pack-mark-v1:${markId}`).update(String(block)).digest();
    for (const b of bytes) {
      if (out.length === count) break;
      out.push((b % 3) - 1);
    }
  }
  return out;
}

/** A value moved by `trit` steps, written with just the digits the step needs. */
function moved(value: number, step: number, trit: number): string {
  const digits = Math.min(15, Math.max(0, Math.round(-Math.log10(step))));
  return (value + trit * step).toFixed(digits).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

/** The code of one download: every markable literal moved by its trit of `markId`. */
export function applyMark(code: string, literals: readonly MarkableLiteral[], markId: string): string {
  const trits = markTrits(markId, literals.length);
  let out = code;
  for (let i = literals.length - 1; i >= 0; i--) {
    const trit = trits[i]!;
    if (trit === 0) continue;
    const lit = literals[i]!;
    out = out.slice(0, lit.start) + moved(lit.value, lit.step, trit) + out.slice(lit.end);
  }
  return out;
}

/**
 * The trits a copy carries, read against the build's literals: the copy's numeric literals in source order, each compared with the
 * build's literal at the same place in the list (null where the lists do not line up or a value is no whole step away).
 */
export function readMarkTrits(copy: string, built: readonly MarkableLiteral[]): (number | null)[] {
  let found: number[];
  try {
    found = numericLiterals(copy);
  } catch {
    return built.map(() => null);
  }
  const values = valuesAtMarkable(found, built);
  return built.map((lit, i) => {
    const v = values[i];
    if (v === undefined) return null;
    const trit = Math.round((v - lit.value) / lit.step);
    return trit >= -1 && trit <= 1 && Math.abs(v - (lit.value + trit * lit.step)) < lit.step / 4 ? trit : null;
  });
}

/** How well a copy's trits fit a mark: the share of the readable trits that agree, and how many were readable. */
export function scoreMark(trits: readonly (number | null)[], markId: string): { agree: number; readable: number; score: number } {
  const want = markTrits(markId, trits.length);
  let agree = 0;
  let readable = 0;
  trits.forEach((t, i) => {
    if (t === null) return;
    readable++;
    if (t === want[i]) agree++;
  });
  return { agree, readable, score: readable === 0 ? 0 : agree / readable };
}

/** Every numeric literal value of a script, and every decimal of the pictures held in its strings, in source order. */
function numericLiterals(code: string): number[] {
  const ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
  const out: { at: number; value: number }[] = [];
  ancestor(ast, {
    Literal(node) {
      const lit = node as unknown as { start: number; value: unknown; raw?: string };
      if (typeof lit.value === 'number') out.push({ at: lit.start, value: lit.value });
      else if (typeof lit.value === 'string' && lit.raw !== undefined && lit.value.includes('<svg')) {
        for (const d of svgDecimals(lit.raw)) out.push({ at: lit.start + d.at, value: Number(d.text) });
      }
    },
  });
  return out.sort((a, b) => a.at - b.at).map((x) => x.value);
}

/**
 * The copy's value at each of the build's markable places. A copy whose numbers are the build's in the same order (served as it
 * was, or re-minified without reordering) lines up by walking both lists: a literal the build did not mark is skipped by its value.
 */
function valuesAtMarkable(found: readonly number[], built: readonly MarkableLiteral[]): (number | undefined)[] {
  const out: (number | undefined)[] = [];
  let j = 0;
  for (const lit of built) {
    while (j < found.length && Math.abs(found[j]! - lit.value) > lit.step * 1.5) j++;
    out.push(j < found.length ? found[j] : undefined);
    if (j < found.length) j++;
  }
  return out;
}
