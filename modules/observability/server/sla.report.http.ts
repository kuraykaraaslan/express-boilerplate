import { NextResponse } from 'next/server'
import { reportFilename, reportToCsv, type SlaReport } from './sla.report'
import { renderSlaPdf } from './sla.report.pdf'

/** The response for a report in the format asked for. Always a download for csv and pdf, never cached, never sniffed. */
export function reportResponse(report: SlaReport, format: 'json' | 'csv' | 'pdf'): NextResponse {
  const common = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
  const file = reportFilename(report.scope.name, report.period.from, report.period.to, format)
  if (format === 'csv') {
    return new NextResponse(reportToCsv(report), { headers: { ...common, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${file}"` } })
  }
  if (format === 'pdf') {
    // A Uint8Array is a valid body at runtime; the cast only bridges the lib.dom / Node Buffer typings.
    return new NextResponse(renderSlaPdf(report) as unknown as BodyInit, { headers: { ...common, 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${file}"` } })
  }
  return NextResponse.json({ report }, { headers: common })
}
