import { createHash } from 'node:crypto'
import type { Labels } from './alert.matchers'

/**
 * The identity of an alert: the same source and the same labels are the same alert, however many times it fires. Label order does not
 * matter. A sender that supplies its own fingerprint (Alertmanager does) keeps it, scoped by the source so two integrations cannot
 * collide or overwrite each other's alerts.
 */
export function alertFingerprint(source: string, labels: Labels, senderFingerprint?: string | null): string {
  const h = createHash('sha256')
  h.update(source)
  h.update('\0')
  if (senderFingerprint) {
    h.update('fp\0')
    h.update(senderFingerprint.slice(0, 200))
  } else {
    for (const k of Object.keys(labels).sort()) { h.update(k); h.update('\0'); h.update(labels[k]); h.update('\0') }
  }
  return h.digest('hex').slice(0, 32)
}
