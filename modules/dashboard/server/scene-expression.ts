/**
 * The convert expression of a symbol field (dashboard phase 45.3, D45-4 as D45-10 narrowed it): ONE JavaScript expression over `value` (the field's
 * raw value), `row` (the symbol's assembled raw row, `{ <field>: value, … }`) and `now` (ms since the epoch): `!value`, `value / 4095 * 100`,
 * `value > 80 ? "alarm" : "ok"`. Not a module, not a statement list: one expression, at most `MAX_EXPRESSION_CHARS` characters, no line break.
 *
 * `expressionProblems(src)` is the ONE judge of whether a text may run, shared by the binding DTO (the server refuses what it would never run), the
 * runner (`scene-convert.ts`, before a script is built for the compute frame) and the panel's preview. Pure: no node and no DOM import, so the browser
 * runs it too. It does not run the text and does not call `eval`; it reads it with a small tokenizer and a validating expression parser
 * (precedence climbing), so a text that passes is syntactically one JavaScript expression and nothing else.
 *
 * What it refuses, on top of any text that is not one expression:
 *  - every statement and declaration form and every way out of one expression: `;`, a backtick (template), `=>` (arrow), `function`, `class`, `import`,
 *    `export`, `new`, `delete`, loops (`for`, `while`, `do`), `if`, `with`, `try`, `throw`, `return`, `var`/`let`/`const`, `async`/`await`/`yield`, comments
 *    (`//`, `/*`), regular expression literals (a `/` is always a division), assignment (`=`, `+=`, `++` …), `\u` / `\x` escapes in a string;
 *  - a NAME that is not `value`, `row`, `now` or one of the few pure globals (`Math`, `Number`, `String`, `Boolean`, `parseFloat`, `parseInt`, `isNaN`,
 *    `isFinite`, `NaN`, `Infinity`, `undefined`): `eval`, `Function`, `window`, `self`, `globalThis`, `fetch`, `XMLHttpRequest`, `postMessage`, `Worker`,
 *    `Object`, `Reflect` … are unknown names, not a list that could miss one;
 *  - the member names that reach the machinery: `constructor`, `__proto__`, `prototype`, `caller`, `callee`, `call`, `apply`, `bind`, `__defineGetter__` and
 *    friends, and the ones that allocate without bound (`repeat`, `padStart`, `padEnd`).
 * The compute frame's policy (no network, no eval, an opaque origin, a time budget; `compute-shell.ts`) is the wall that holds whatever this misses; this
 * check is the first line, and the one that gives a person a plain message.
 */

/** The longest expression. A one-liner; a longer need is not a field's convert. */
export const MAX_EXPRESSION_CHARS = 200

/** The names an expression may read (every other bare name is an unknown name): its three inputs and the pure globals. */
export const EXPRESSION_NAMES: ReadonlySet<string> = new Set([
  'value', 'row', 'now', 'Math', 'Number', 'String', 'Boolean', 'parseFloat', 'parseInt', 'isNaN', 'isFinite', 'NaN', 'Infinity', 'undefined',
  'true', 'false', 'null',
])

/** Words that are operators in an expression (`typeof x`, `"a" in row`, `x instanceof Y` is refused with its `Y`: there is no constructor to name). */
const WORD_OPERATORS: ReadonlySet<string> = new Set(['typeof', 'void', 'in'])

/** Words refused by name first, so the message says what the word is (everything else unknown is "unknown name"). */
const REFUSED_WORDS: ReadonlySet<string> = new Set([
  'import', 'export', 'eval', 'Function', 'function', 'class', 'new', 'delete', 'this', 'arguments', 'super', 'async', 'await', 'yield', 'var', 'let', 'const',
  'return', 'throw', 'try', 'catch', 'finally', 'if', 'else', 'switch', 'case', 'default', 'for', 'while', 'do', 'with', 'break', 'continue', 'debugger',
  'instanceof', 'of', 'window', 'self', 'globalThis', 'fetch', 'XMLHttpRequest', 'postMessage', 'importScripts', 'Worker', 'WebSocket', 'constructor',
  '__proto__', 'prototype',
])

/** Member names (after a `.` or `?.`, or a quoted key in brackets) an expression never names. */
const REFUSED_MEMBERS: ReadonlySet<string> = new Set([
  'constructor', '__proto__', 'prototype', 'caller', 'callee', 'call', 'apply', 'bind', '__defineGetter__', '__defineSetter__', '__lookupGetter__',
  '__lookupSetter__', 'repeat', 'padStart', 'padEnd',
])

// ─── Named inputs (phase 45, slice 16, SU-3): an expression over SEVERAL device values ───────────────────────────────────────────

/** The most named inputs one field's expression may read beside `value`. */
export const MAX_INPUTS_PER_FIELD = 4
/** An input's name: a lower-case word a person reads in the formula (`supply`, `return_temp`), at most 16 characters. */
export const INPUT_NAME_RE = /^[a-z][a-z0-9_]{0,15}$/
/**
 * Words that can never be an input's name: the fixed names of a formula, the refused words, the word operators and every JavaScript reserved
 * word (an input becomes a `const` of the generated function, so `return` or `in` would not even parse there). A label that gives such a word
 * is suffixed by the panel (`return_in`), never stored as is.
 */
const JS_RESERVED: ReadonlySet<string> = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally',
  'for', 'function', 'if', 'import', 'in', 'instanceof', 'new', 'null', 'return', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var',
  'void', 'while', 'with', 'yield', 'let', 'static', 'implements', 'interface', 'package', 'private', 'protected', 'public', 'await', 'async', 'of',
  'arguments', 'eval', 'undefined',
])
export const isReservedInputName = (name: string): boolean => EXPRESSION_NAMES.has(name) || REFUSED_WORDS.has(name) || WORD_OPERATORS.has(name) || JS_RESERVED.has(name)

/** Why `name` may not name an input (the first problem), or an empty list. */
export function inputNameProblems(name: unknown): string[] {
  if (typeof name !== 'string') return ['an input name is text']
  if (!INPUT_NAME_RE.test(name)) return [`"${show(name)}" is not an input name (a lower-case word of letters, digits and _, at most 16 characters)`]
  if (isReservedInputName(name)) return [`"${name}" cannot be an input name (it is a word of the formula language)`]
  return []
}
export const isInputName = (name: unknown): name is string => inputNameProblems(name).length === 0

/** The sentence that lists what a formula may read, for the "unknown name" message. */
function readsText(inputs: readonly string[]): string {
  return inputs.length === 0 ? 'a formula reads value, row and now' : `a formula reads value, row, now and the inputs ${inputs.join(', ')}`
}

type Tok =
  | { t: 'num'; v: string; at: number }
  | { t: 'str'; v: string; at: number }
  | { t: 'name'; v: string; at: number }
  | { t: 'op'; v: string; at: number }

/** Operators, longest first (the tokenizer reads greedily). `++`, `--`, `=`, `+=` and the rest are not here: they are refused by name. */
const OPERATORS = [
  '>>>', '===', '!==', '**', '??', '?.', '&&', '||', '==', '!=', '<=', '>=', '<<', '>>',
  '+', '-', '*', '/', '%', '<', '>', '!', '~', '&', '|', '^', '?', ':', ',', '.', '(', ')', '[', ']', '{', '}',
]
const NUMBER = /^(?:0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/
const NAME = /^[A-Za-z_$][A-Za-z0-9_$]*/
// a C0 or C1 control, a line or paragraph separator, a byte-order mark: nothing in an expression, in or out of a string
// eslint-disable-next-line no-control-regex
const BAD_CHAR = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\ufeff]/

class Refused extends Error {}
const refuse = (message: string): never => { throw new Refused(message) }

function show(s: string): string {
  return s.length > 24 ? `${s.slice(0, 24)}…` : s
}

/** Reads the text into tokens, or refuses with the first thing that is not part of an expression. */
function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === ' ' || c === '\t') { i += 1; continue }
    if (BAD_CHAR.test(c)) return refuse(c === '\n' || c === '\r' ? 'a formula is one line' : 'a control character is not allowed')
    if (c === '`') return refuse('a template string (backtick) is not allowed')
    if (c === ';') return refuse('a formula is one expression: ";" is not allowed')
    if (c === '"' || c === '\'') {
      const start = i
      let v = ''
      i += 1
      for (;;) {
        if (i >= src.length) return refuse(`the text starting at position ${start + 1} is not closed`)
        const d = src[i]
        if (d === c) { i += 1; break }
        if (BAD_CHAR.test(d)) return refuse(d === '\n' || d === '\r' ? 'a formula is one line' : 'a control character is not allowed')
        if (d === '\\') {
          const e = src[i + 1]
          if (e === undefined) return refuse(`the text starting at position ${start + 1} is not closed`)
          if (e === 'n') v += '\n'
          else if (e === 't') v += '\t'
          else if (e === '\\' || e === '"' || e === '\'') v += e
          else return refuse(`the escape "\\${e}" is not allowed in a text (only \\n, \\t, \\\\, \\" and \\')`)
          i += 2
          continue
        }
        v += d
        i += 1
      }
      out.push({ t: 'str', v, at: start })
      continue
    }
    if (c === '/' && (src[i + 1] === '/' || src[i + 1] === '*')) return refuse('a comment is not allowed')
    if (c === '=' && src[i + 1] === '>') return refuse('an arrow function ("=>") is not allowed')
    const rest = src.slice(i)
    if (rest.startsWith('++') || rest.startsWith('--')) return refuse('"++" and "--" are not allowed (a formula only reads value, row and now)')
    const operator = OPERATORS.find((o) => rest.startsWith(o))
    // `?.` followed by a digit is a conditional and a number (`a?.5:1`), not an optional chain
    const op = operator === '?.' && /^\?\.\d/.test(rest) ? '?' : operator
    // a lone `=` (the `+=`, `&&=` … forms leave one behind): the operators above already took `==`, `===`, `<=`, `>=`, `!=`, `!==`
    if (c === '=' && !op) return refuse('assignment is not allowed (a formula only reads value, row and now)')
    if (/^[0-9.]/.test(c) && !(c === '.' && !/^\.\d/.test(rest))) {
      const m = NUMBER.exec(rest)
      if (!m) return refuse(`"${show(rest)}" is not a number`)
      if (/^[A-Za-z0-9_$]/.test(rest.slice(m[0].length, m[0].length + 1))) return refuse(`"${show(rest)}" is not a number`)
      out.push({ t: 'num', v: m[0], at: i })
      i += m[0].length
      continue
    }
    if (op) {
      out.push({ t: 'op', v: op, at: i })
      i += op.length
      continue
    }
    const n = NAME.exec(rest)
    if (n) {
      out.push({ t: 'name', v: n[0], at: i })
      i += n[0].length
      continue
    }
    return refuse(`"${c}" is not allowed in a formula`)
  }
  return out
}

/** Binary operators by binding power (higher binds tighter); `**` is right associative and `??` / `||` / `&&` are judged for mixing below. */
const BINARY: Readonly<Record<string, number>> = {
  '??': 1, '||': 2, '&&': 3, '|': 4, '^': 5, '&': 6, '==': 7, '!=': 7, '===': 7, '!==': 7,
  '<': 8, '>': 8, '<=': 8, '>=': 8, in: 8, '<<': 9, '>>': 9, '>>>': 9, '+': 10, '-': 10, '*': 11, '/': 11, '%': 11, '**': 12,
}
const UNARY = new Set(['!', '-', '+', '~'])

/** The validating parser: it builds nothing, it only accepts or refuses. A refused text names the token it stopped at. */
class Parser {
  private p = 0
  /** The bare names this text may read: the fixed names and the entry's own inputs. */
  constructor(private readonly toks: Tok[], private readonly allowed: ReadonlySet<string> = EXPRESSION_NAMES, private readonly inputs: readonly string[] = []) {}

  private peek(): Tok | undefined { return this.toks[this.p] }
  private next(): Tok { return this.toks[this.p++] }
  private isOp(v: string): boolean { const t = this.peek(); return !!t && t.t === 'op' && t.v === v }
  private isWord(v: string): boolean { const t = this.peek(); return !!t && t.t === 'name' && t.v === v }
  private unexpected(): never {
    const t = this.peek()
    return refuse(t ? `unexpected "${show(t.t === 'str' ? JSON.stringify(t.v) : t.v)}" at position ${t.at + 1}` : 'the formula ends too soon')
  }
  private expect(v: string): void { if (!this.isOp(v)) this.unexpected(); this.p += 1 }

  /** The whole text: one expression and nothing after it. */
  parse(): void {
    if (this.toks.length === 0) refuse('the formula is empty')
    this.expression()
    if (this.p < this.toks.length) this.unexpected()
  }

  /** expression := conditional (`,` conditional)* . The comma operator is allowed at the top and inside parentheses. */
  private expression(): void {
    this.conditional()
    while (this.isOp(',')) { this.p += 1; this.conditional() }
  }

  private conditional(): void {
    this.binary(0)
    if (this.isOp('?')) {
      this.p += 1
      this.conditional()
      this.expect(':')
      this.conditional()
    }
  }

  private binary(minPower: number, parent?: string): void {
    // `-x ** 2` is a syntax error in JavaScript (the exponent's base must not be a bare unary): refused here as well
    const startsUnary = (() => { const t = this.peek(); return !!t && ((t.t === 'op' && UNARY.has(t.v)) || (t.t === 'name' && WORD_OPERATORS.has(t.v) && t.v !== 'in')) })()
    this.unary()
    let mixed: Set<string> | null = null
    for (;;) {
      const t = this.peek()
      if (!t) return
      const v = t.t === 'op' || (t.t === 'name' && t.v === 'in') ? t.v : null
      const power = v !== null && Object.hasOwn(BINARY, v) ? BINARY[v] : undefined
      if (v === null || power === undefined || power < minPower) return
      if (v === '**' && startsUnary) refuse('put parentheses around a negative or "!" base before "**"')
      // `a ?? b || c` is a syntax error without parentheses
      if (parent === '??' && (v === '||' || v === '&&')) refuse('put parentheses around "??" when it is mixed with "||" or "&&"')
      if (v === '??' || v === '||' || v === '&&') {
        mixed ??= new Set()
        mixed.add(v)
        if (mixed.has('??') && (mixed.has('||') || mixed.has('&&'))) refuse('put parentheses around "??" when it is mixed with "||" or "&&"')
      }
      this.p += 1
      this.binary(v === '**' ? power : power + 1, v)
    }
  }

  private unary(): void {
    const t = this.peek()
    if (t && t.t === 'op' && UNARY.has(t.v)) { this.p += 1; this.unary(); return }
    if (t && t.t === 'name' && (t.v === 'typeof' || t.v === 'void')) { this.p += 1; this.unary(); return }
    this.postfix()
  }

  private postfix(): void {
    this.primary()
    for (;;) {
      if (this.isOp('.') || this.isOp('?.')) {
        const optional = this.next().v === '?.'
        if (optional && (this.isOp('(') || this.isOp('['))) { this.step(); continue }
        const name = this.peek()
        if (!name || name.t !== 'name') this.unexpected()
        this.member((name as { v: string }).v)
        this.p += 1
        continue
      }
      if (this.isOp('[') || this.isOp('(')) { this.step(); continue }
      return
    }
  }

  /** `[expr]` (a quoted member name is judged like a dotted one) or a call's argument list. */
  private step(): void {
    if (this.isOp('[')) {
      this.p += 1
      const key = this.peek()
      if (key && key.t === 'str') this.member(key.v)
      this.expression()
      this.expect(']')
    } else {
      this.p += 1
      if (!this.isOp(')')) {
        this.conditional()
        while (this.isOp(',')) { this.p += 1; this.conditional() }
      }
      this.expect(')')
    }
  }

  private member(name: string): void {
    if (REFUSED_MEMBERS.has(name)) refuse(`".${name}" is not allowed in a formula`)
  }

  private primary(): void {
    const t = this.peek()
    if (!t) return this.unexpected()
    if (t.t === 'num' || t.t === 'str') { this.p += 1; return }
    if (t.t === 'name') {
      if (this.allowed.has(t.v)) { this.p += 1; return }
      if (REFUSED_WORDS.has(t.v)) return refuse(`"${t.v}" is not allowed in a formula`)
      return refuse(`unknown name "${show(t.v)}" (${readsText(this.inputs)})`)
    }
    if (t.v === '(') { this.p += 1; this.expression(); this.expect(')'); return }
    if (t.v === '[') {
      this.p += 1
      while (!this.isOp(']')) {
        this.conditional()
        if (this.isOp(',')) this.p += 1
        else break
      }
      this.expect(']')
      return
    }
    if (t.v === '{') { this.objectLiteral(); return }
    return this.unexpected()
  }

  /** `{ key: value, "text key": value, 3: value, key }` : a key is a name (any, it is a key), a text or a number; a bare key reads that name. */
  private objectLiteral(): void {
    this.p += 1
    while (!this.isOp('}')) {
      const k = this.peek()
      if (!k) return this.unexpected()
      if (k.t === 'op') return this.unexpected()
      this.p += 1
      if (k.t === 'name' || k.t === 'str') this.member(k.v)
      if (this.isOp(':')) {
        this.p += 1
        this.conditional()
      } else if (k.t === 'name') {
        // shorthand `{ value }` reads that name: it must be one an expression may read
        if (!this.allowed.has(k.v)) refuse(`unknown name "${show(k.v)}" (${readsText(this.inputs)})`)
      } else return this.unexpected()
      if (this.isOp(',')) this.p += 1
      else break
    }
    this.expect('}')
  }
}

/**
 * Why `src` may not run, as plain sentences (the first problem only: a person fixes one thing at a time), or an empty list when it may. Pure.
 * A text that passes is one JavaScript expression over `value`, `row`, `now` and the entry's own `inputs` (slice 16, SU-3: at most
 * `MAX_INPUTS_PER_FIELD` names that pass `inputNameProblems`; a bad input name is a problem of the text, so no caller can widen the whitelist
 * with a word of the language), with no statement, no unknown name and no way to name `constructor`. Every refusal of a text without inputs is
 * the same with them: the inputs only add bare names.
 */
export function expressionProblems(src: unknown, inputs: readonly string[] = []): string[] {
  if (typeof src !== 'string') return ['a formula is text']
  if (src.trim() === '') return ['the formula is empty']
  if (src.length > MAX_EXPRESSION_CHARS) return [`the formula is ${src.length} characters; at most ${MAX_EXPRESSION_CHARS}`]
  if (inputs.length > MAX_INPUTS_PER_FIELD) return [`a formula reads at most ${MAX_INPUTS_PER_FIELD} inputs`]
  for (const name of inputs) {
    const p = inputNameProblems(name)
    if (p.length) return p
  }
  const allowed = inputs.length === 0 ? EXPRESSION_NAMES : new Set([...EXPRESSION_NAMES, ...inputs])
  try {
    new Parser(tokenize(src), allowed, inputs).parse()
  } catch (e) {
    if (e instanceof Refused) return [e.message]
    throw e
  }
  return []
}

/** `expressionProblems` as a boolean. */
export const isExpression = (src: unknown, inputs: readonly string[] = []): src is string => expressionProblems(src, inputs).length === 0
