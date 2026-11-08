/**
 * RFC-4180 CSV parsing and serialisation.
 *
 * A real parser rather than `line.split(',')`, because employee data breaks the
 * naive one immediately: addresses contain commas, Turkish notes contain
 * newlines inside quotes, and a bank account holder can legitimately be
 * `"Yılmaz, Ayşe"`. Getting that wrong on an import silently shifts every
 * column right for one row and writes an address into the email field.
 *
 * Pure functions, no I/O, no dependencies — so they are trivially testable and
 * usable from both the import service and the export route.
 */

/**
 * Parse a CSV document into rows of raw string cells.
 *
 * Handles: quoted fields, embedded commas, embedded newlines, escaped quotes
 * (`""`), CRLF and LF line endings, and a UTF-8 BOM. A trailing newline does not
 * produce a phantom empty row. Semicolon and tab delimiters are auto-detected
 * from the header line, because Excel in a Turkish locale exports `;`.
 */
export function parseCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  if (input.length === 0) return []

  const delimiter = detectDelimiter(input)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let sawAnyChar = false

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]

    if (inQuotes) {
      if (ch === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (input[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
      sawAnyChar = true
      continue
    }

    if (ch === '"') {
      inQuotes = true
      sawAnyChar = true
      continue
    }
    if (ch === delimiter) {
      row.push(field)
      field = ''
      sawAnyChar = true
      continue
    }
    if (ch === '\r') continue
    if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      sawAnyChar = false
      continue
    }
    field += ch
    sawAnyChar = true
  }

  // Flush the last field/row unless the document ended on a clean newline.
  if (sawAnyChar || field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/**
 * Pick the delimiter from the first line: whichever of `,` `;` `\t` occurs most
 * often outside quotes. Defaults to `,` on a tie or a single-column file.
 */
function detectDelimiter(input: string): string {
  const firstLine = input.split(/\r?\n/, 1)[0] ?? ''
  const candidates = [',', ';', '\t']
  let best = ','
  let bestCount = 0
  for (const candidate of candidates) {
    let count = 0
    let inQuotes = false
    for (let i = 0; i < firstLine.length; i += 1) {
      const ch = firstLine[i]
      if (ch === '"') inQuotes = !inQuotes
      else if (ch === candidate && !inQuotes) count += 1
    }
    if (count > bestCount) {
      best = candidate
      bestCount = count
    }
  }
  return best
}

/** Quote a cell only when it needs it, doubling any embedded quote. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  let str = String(value)
  // common.01: a TEXT cell that starts like a formula (= + - @, or a tab / CR a spreadsheet strips first) is written as text
  // with a leading apostrophe, so opening the export never runs it. Numbers, and text that is a plain number, are untouched.
  if (typeof value !== 'number' && typeof value !== 'bigint' && /^[=+\-@\t\r]/.test(str) && !/^-?\d+(?:\.\d+)?$/.test(str)) {
    str = `'${str}`
  }
  if (!/[",\n\r;\t]/.test(str)) return str
  return `"${str.replace(/"/g, '""')}"`
}

/**
 * Serialise rows to CSV with a leading BOM so Excel opens UTF-8 Turkish names
 * correctly instead of rendering `Yılmaz` as `YÄ±lmaz`.
 */
export function toCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  const lines: string[] = [headers.map(csvCell).join(',')]
  for (const row of rows) lines.push(headers.map((h) => csvCell(row[h])).join(','))
  return `﻿${lines.join('\r\n')}\r\n`
}

/**
 * Turn a parsed sheet into `{ header, records }`, where each record maps a
 * TRIMMED header name to its cell. Unknown extra columns are preserved so a
 * caller can report them; short rows yield empty strings rather than undefined.
 */
export function toRecords(rows: string[][]): {
  header: string[]
  records: Array<Record<string, string>>
} {
  if (rows.length === 0) return { header: [], records: [] }
  const header = rows[0].map((h) => h.trim())
  const records: Array<Record<string, string>> = []
  for (let r = 1; r < rows.length; r += 1) {
    const cells = rows[r]
    // Skip a wholly blank line — trailing blank lines are extremely common.
    if (cells.every((c) => c.trim() === '')) continue
    const record: Record<string, string> = {}
    for (let c = 0; c < header.length; c += 1) record[header[c]] = (cells[c] ?? '').trim()
    records.push(record)
  }
  return { header, records }
}
