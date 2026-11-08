import vm from 'node:vm';

// ReDoS containment for the `regex` rule operator.
//
// A JavaScript regex cannot be interrupted from the same thread, so the bound is
// three layers, cheapest first:
//   1. AUTHORING — `assessRegex` rejects patterns that can backtrack
//      catastrophically (a quantified group that itself contains an unbounded
//      quantifier or an alternation, back-references) plus oversize patterns.
//   2. INPUT CAP — the attribute value is clipped to MAX_INPUT_LENGTH, so even a
//      polynomial pattern has a bounded amount of work.
//   3. WATCHDOG — a pattern the static check does NOT clear (rows that predate
//      the authoring check, or a heuristic miss) runs inside a `node:vm` script
//      with a hard `timeout` of `abacRegexTimeoutMs`, which V8 does interrupt
//      mid-backtrack. Cleared patterns skip the watchdog: it costs ~0.5 ms a call.
//
// A timeout, an invalid pattern and an over-long pattern all read as "the rule
// does not hold" — the same answer a malformed regex already gave.

export const MAX_PATTERN_LENGTH = 200;
export const MAX_INPUT_LENGTH = 2048;
// A misconfigured setting must not turn the watchdog into a multi-second stall.
export const MAX_TIMEOUT_MS = 2000;

export type RegexVerdict = { ok: true } | { ok: false; reason: string };

// A bounded repeat at or above this count backtracks like an unbounded one for any realistic input.
const LARGE_REPEAT = 10;

/** Quantifier at `i` ('*', '+', '?', '{n}', '{n,}', '{n,m}') → its length and whether it can repeat without a small bound. */
function quantifierAt(pattern: string, i: number): { length: number; unbounded: boolean } | null {
  const c = pattern[i];
  if (c === '*' || c === '+') return { length: 1, unbounded: true };
  if (c === '?') return { length: 1, unbounded: false };
  if (c === '{') {
    const m = /^\{(\d+)(,(\d*))?\}/.exec(pattern.slice(i));
    if (!m) return null;
    const max = m[2] === undefined ? Number(m[1]) : m[3] === '' ? Infinity : Number(m[3]);
    return { length: m[0].length, unbounded: max >= LARGE_REPEAT };
  }
  return null;
}

interface GroupFrame {
  hasQuantifier: boolean;
  hasAlternation: boolean;
}

/**
 * Static ReDoS heuristic. Flags the families that cause exponential backtracking:
 * `(a+)+`, `(a*)*`, `(a|a)*`, `(\w+\s?)*` and back-references. It is a filter, not
 * a proof — the watchdog backs it up for whatever it clears.
 */
export function assessRegex(pattern: string): RegexVerdict {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return { ok: false, reason: `pattern is longer than ${MAX_PATTERN_LENGTH} characters` };
  }
  try {
    new RegExp(pattern, 'i');
  } catch {
    return { ok: false, reason: 'pattern is not a valid regular expression' };
  }

  const stack: GroupFrame[] = [];
  let top: GroupFrame = { hasQuantifier: false, hasAlternation: false };
  let inClass = false;

  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\') {
      const next = pattern[i + 1] ?? '';
      if (/[1-9]/.test(next) || (next === 'k' && pattern[i + 2] === '<')) {
        return { ok: false, reason: 'back-references are not allowed' };
      }
      i++; // the escaped character is a literal / class escape, never structure
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
      continue;
    }
    if (c === '[') {
      inClass = true;
      continue;
    }
    if (c === '(') {
      stack.push(top);
      top = { hasQuantifier: false, hasAlternation: false };
      continue;
    }
    if (c === '|') {
      top.hasAlternation = true;
      continue;
    }
    if (c === ')') {
      const closed = top;
      top = stack.pop() ?? { hasQuantifier: false, hasAlternation: false };
      const q = quantifierAt(pattern, i + 1);
      if (q?.unbounded && (closed.hasQuantifier || closed.hasAlternation)) {
        return { ok: false, reason: 'nested repetition can backtrack catastrophically' };
      }
      // Whatever the closed group contained, the enclosing group now contains too.
      top.hasQuantifier ||= closed.hasQuantifier || Boolean(q?.unbounded);
      top.hasAlternation ||= closed.hasAlternation;
      if (q) i += q.length;
      continue;
    }
    const q = quantifierAt(pattern, i);
    if (q) {
      if (q.unbounded) top.hasQuantifier = true;
      i += q.length - 1;
    }
  }
  return { ok: true };
}

// Compiled patterns, bounded so a policy set with many one-off patterns cannot grow it forever.
const COMPILE_CACHE_MAX = 500;
const compiled = new Map<string, { re: RegExp; guarded: boolean } | null>();

function compile(pattern: string): { re: RegExp; guarded: boolean } | null {
  const hit = compiled.get(pattern);
  if (hit !== undefined) return hit;
  let entry: { re: RegExp; guarded: boolean } | null = null;
  if (pattern.length <= MAX_PATTERN_LENGTH) {
    try {
      entry = { re: new RegExp(pattern, 'i'), guarded: !assessRegex(pattern).ok };
    } catch {
      entry = null;
    }
  }
  if (compiled.size >= COMPILE_CACHE_MAX) compiled.delete(compiled.keys().next().value as string);
  compiled.set(pattern, entry);
  return entry;
}

const sandbox = vm.createContext({ re: null as RegExp | null, input: '' });
const watchdog = new vm.Script('re.test(input)');

/** Run one match under a hard wall-clock limit. Throws on timeout. */
function testWithTimeout(re: RegExp, input: string, timeoutMs: number): boolean {
  sandbox.re = re;
  sandbox.input = input;
  try {
    return watchdog.runInContext(sandbox, { timeout: Math.min(MAX_TIMEOUT_MS, Math.max(1, Math.trunc(timeoutMs) || 1)) }) === true;
  } finally {
    sandbox.re = null;
    sandbox.input = '';
  }
}

/**
 * Bounded `new RegExp(pattern, 'i').test(input)`. Returns false for an invalid or
 * oversize pattern and for a match that overruns `timeoutMs`.
 */
export function boundedRegexTest(pattern: string, input: string, timeoutMs: number): boolean {
  const entry = compile(pattern);
  if (!entry) return false;
  const clipped = input.length > MAX_INPUT_LENGTH ? input.slice(0, MAX_INPUT_LENGTH) : input;
  if (!entry.guarded) return entry.re.test(clipped);
  try {
    return testWithTimeout(entry.re, clipped, timeoutMs);
  } catch {
    return false;
  }
}

/** Test seam: drop the compile cache. */
export function clearRegexCache(): void {
  compiled.clear();
}
