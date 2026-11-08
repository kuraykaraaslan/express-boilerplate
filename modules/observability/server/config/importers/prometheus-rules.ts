import { ConfigParseError, parseConfigText } from '../config.parse'
import { blank, finish, isObj, KeyAllocator, newReport, str, type Importer } from './importer.types'

/**
 * Prometheus rule files (alerting rules), the `groups:` YAML.
 *
 * VERIFIED (2026-10-18, prometheus.io alerting_rules and recording_rules pages): top-level `groups`; a group has `name`, optional `interval`,
 * `limit` and `labels`; a rule is either an alerting rule (`alert`, `expr`, optional `for`, `keep_firing_for`, `labels`, `annotations`) or a recording
 * rule (`record`, `expr`, `labels`).
 *
 * What this can honestly do: this platform does not evaluate PromQL, so a rule's `expr` and `for` do not come across; the alert reaches the pipeline
 * when Alertmanager (or Grafana) sends it to an ingest key. What the rule's LABELS decide is how it is routed, so each alerting rule becomes a
 * routing rule that matches its alertname (and its static labels), and one Alertmanager integration is added to receive them. Routes are written
 * DISABLED with no targets: a route with no target would swallow what it matches, so the operator enables it after choosing where it goes.
 * The annotations (summary, runbook) are listed in the report as notes. Recording rules are refused: they produce series, not alerts.
 */
export const prometheusRulesImporter: Importer = {
  id: 'prometheus-rules',
  title: 'Prometheus alerting rule files (YAML)',
  accepts: ['yaml'],
  cannotMap: [
    'the rule expression and the `for` / `keep_firing_for` durations (PromQL is evaluated by Prometheus; alerts arrive through Alertmanager to an ingest key)',
    'recording rules (they produce series, not alerts)',
    'templated labels and alert names ({{ ... }})',
    'receivers and the Alertmanager routing tree (a different file; send the alerts to the integration and route them here)',
    'notification targets (routes are written disabled until a target is chosen)',
  ],
  run(text) {
    const report = newReport('prometheus-rules', 'rule-file syntax verified against the Prometheus documentation')
    let doc: unknown
    try { doc = parseConfigText(text, 'yaml') } catch (e) { report.errors.push((e as ConfigParseError).message); return finish(report, blank()) }
    if (!isObj(doc) || !Array.isArray(doc.groups)) {
      report.errors.push(isObj(doc) && ('route' in doc || 'receivers' in doc) ? 'this is an Alertmanager configuration, not a rule file (no `groups`)' : 'this is not a Prometheus rule file (no `groups`)')
      return finish(report, blank())
    }
    const groups = doc.groups as unknown[]
    if (!groups.every(isObj)) { report.errors.push('a group is not an object'); return finish(report, blank()) }
    const keys = new KeyAllocator()
    const draft = blank()
    const labelName = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/
    for (const g of groups as Array<Record<string, unknown>>) {
      const gname = str(g.name) ?? '(unnamed group)'
      if (!Array.isArray(g.rules)) { report.errors.push(`group "${gname}" has no rules list`); continue }
      const groupLabels = isObj(g.labels) ? g.labels : {}
      for (const r of g.rules as unknown[]) {
        if (!isObj(r)) { report.errors.push(`group "${gname}" has a rule that is not an object`); continue }
        if (str(r.record)) { report.unmapped.push({ item: `recording rule ${str(r.record)} (group ${gname})`, reason: 'recording rules produce series, not alerts' }); continue }
        const alert = str(r.alert)
        if (!alert) { report.errors.push(`group "${gname}" has a rule with neither alert nor record`); continue }
        const from = `alert ${alert} (group ${gname})`
        if (alert.includes('{{')) { report.unmapped.push({ item: from, reason: 'a templated alert name cannot be matched' }); continue }
        const labels: Record<string, string> = {}
        const notes: string[] = []
        for (const [k, v] of Object.entries({ ...groupLabels, ...(isObj(r.labels) ? r.labels : {}) })) {
          if (typeof v !== 'string' || v.includes('{{') || !labelName.test(k)) { notes.push(`the label ${k} is templated or not a string and is not matched`); continue }
          labels[k] = v
        }
        const key = keys.next(`prom ${alert}`, 'route')
        const matchers = [{ label: 'alertname', op: '=', value: alert }, ...Object.entries(labels).filter(([k]) => k !== 'alertname').slice(0, 18).map(([label, value]) => ({ label, op: '=', value }))]
        draft.routes.push({
          key, name: `Prometheus: ${alert}`.slice(0, 120), matchers, groupBy: ['alertname'], enabled: false, targets: [],
        } as never)
        const ann = isObj(r.annotations) ? r.annotations : {}
        for (const n of ['summary', 'description', 'runbook_url', 'runbook']) if (str(ann[n])) notes.push(`${n}: ${(str(ann[n]) as string).slice(0, 300)}`)
        if (str(r.for)) notes.push(`for ${str(r.for)} is applied by Prometheus before the alert is sent`)
        notes.push('written disabled with no targets: choose where it goes, then enable it')
        report.mapped.push({ kind: 'route', key, from, notes })
        report.unmapped.push({ item: `expr of ${alert}`, reason: 'PromQL is evaluated by Prometheus, not here' })
      }
    }
    if (draft.routes.length > 0) {
      draft.integrations.push({ key: 'prometheus', name: 'Prometheus (Alertmanager)', kind: 'ALERTMANAGER', severityCeiling: 'MAJOR', enabled: true } as never)
      report.mapped.push({ kind: 'integration', key: 'prometheus', from: 'the Alertmanager that sends these alerts', notes: ['a key is issued when the file is applied; point the Alertmanager webhook receiver at it'] })
      report.warnings.push('every route was written disabled: until a target is chosen, alerts that match nothing enabled follow the default policy')
    }
    return finish(report, draft)
  },
}
