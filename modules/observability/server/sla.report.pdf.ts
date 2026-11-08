import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { cleanText, type SlaReport, type SlaRow } from './sla.report'

/**
 * The PDF of an SLA report. `jspdf` (+ `jspdf-autotable`) is the repository's one PDF engine (the invoice renderer and the packing slip use it),
 * so this module adds no dependency. Content only, no logo or colour theme: the report is a document of record, not a brand surface.
 *
 * The standard PDF fonts cover Latin-1, so every string is reduced to it before drawing (control characters become spaces, anything else outside
 * Latin-1 becomes `?`): a component named with emoji prints `?`, never garbage, and a name can never carry PDF syntax (jsPDF escapes `(`, `)` and `\`
 * in text, and nothing here builds raw PDF objects, links, scripts or actions).
 */

const MAX_TEXT = 120

/** A string safe for the standard fonts: control characters -> space, non-Latin-1 -> `?`, bounded. */
export function pdfText(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return '-'
  const s = cleanText(String(v)).replace(/[^\u0020-\u007e\u00a0-\u00ff]/gu, '?')
  return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT - 3)}...` : s
}

const num = (v: number | null, suffix = ''): string => (v === null ? '-' : `${v}${suffix}`)

/** The table the PDF prints, separated from the drawing so a test can pin it. */
export function pdfTable(report: SlaReport): { head: string[]; body: string[][] } {
  const head = ['Component', 'Monitors', 'Total min', 'Maint. excl. min', 'Unknown min', 'Downtime min', 'Uptime %', 'Incidents', 'Outages', 'Longest outage min', 'Objective %', 'Met']
  const body = report.rows.map((r: SlaRow) => [
    pdfText(r.name), String(r.monitorCount), num(r.totalMinutes), num(r.excludedMaintenanceMinutes), num(r.unknownMinutes), num(r.downtimeMinutes),
    r.uptimePercent === null ? 'no data' : String(r.uptimePercent), num(r.incidents), num(r.outages), num(r.longestOutageMinutes),
    num(r.objectivePercent), r.objectiveMet === null ? '-' : r.objectiveMet ? 'yes' : 'NO',
  ])
  return { head, body }
}

export function renderSlaPdf(report: SlaReport): Uint8Array {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
  doc.setProperties({ title: `SLA report ${pdfText(report.scope.name)} ${report.period.from} to ${report.period.to}`, creator: 'observability' })
  const left = 12
  let y = 16
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16)
  doc.text('SLA report', left, y)
  y += 7
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
  const meta = [
    `${report.scope.kind === 'slo' ? 'SLO' : 'Status page'}: ${pdfText(report.scope.name)}`,
    `Period: ${report.period.from} to ${report.period.to} (UTC, ${report.period.days} day${report.period.days === 1 ? '' : 's'})`,
    `Generated: ${report.generatedAt}`,
    `Planned maintenance is ${report.maintenanceExcluded ? 'left out of the denominator and of the downtime' : 'counted like any other time (the workspace does not exclude it)'}.`,
  ]
  for (const line of meta) { doc.text(line, left, y); y += 5 }

  const { head, body } = pdfTable(report)
  autoTable(doc, {
    startY: y + 2, head: [head], body: body.length ? body : [['No components', ...head.slice(1).map(() => '-')]],
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.5 }, headStyles: { fillColor: [60, 60, 60] },
    columnStyles: Object.fromEntries(head.slice(1).map((_, i) => [i + 1, { halign: 'right' as const }])),
    margin: { left, right: left },
  })

  // @ts-expect-error lastAutoTable is added by the autotable plugin
  let notesY: number = (doc.lastAutoTable?.finalY ?? y + 20) + 8
  const pageHeight = doc.internal.pageSize.getHeight()
  doc.setFontSize(8)
  for (const note of report.notes) {
    const lines = doc.splitTextToSize(pdfText(note), doc.internal.pageSize.getWidth() - 2 * left) as string[]
    if (notesY + lines.length * 4 > pageHeight - 10) { doc.addPage(); notesY = 16 }
    doc.text(lines, left, notesY)
    notesY += lines.length * 4 + 1
  }
  return new Uint8Array(doc.output('arraybuffer'))
}
