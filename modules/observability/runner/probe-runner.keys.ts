import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createPrivateKey, createPublicKey } from 'node:crypto'
import { join } from 'node:path'
import { generateRunnerKeyPair, keyFingerprint } from '../server/probe.signing'

/**
 * The runner's identity on disk (observability phase 10.2). The private key is generated HERE and never leaves this host; files are 0600 in a 0700
 * directory, and a key readable by group or other is refused outright rather than used (the same rule as the fleet agent's key files).
 */
export interface RunnerIdentity { privateKeyPem: string; publicKeyPem: string; fingerprint: string; runnerId: string | null }

const FILES = { private: 'runner.key.pem', public: 'runner.pub.pem', state: 'runner.json' } as const

function permissionProblem(path: string, label: string, want: 'dir' | 'file'): string | null {
  if (process.platform === 'win32') return null
  let mode: number
  try { mode = statSync(path).mode } catch { return null }
  return (mode & 0o077) === 0 ? null : `${label} ${path} is accessible by group/other (mode ${(mode & 0o777).toString(8)}): run chmod ${want === 'dir' ? '700' : '600'} on it`
}

export function loadOrCreateIdentity(dir: string): RunnerIdentity {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  const dirProblem = permissionProblem(dir, 'key directory', 'dir')
  if (dirProblem) throw new Error(dirProblem)
  const priv = join(dir, FILES.private)
  const pub = join(dir, FILES.public)
  if (!existsSync(priv)) {
    const k = generateRunnerKeyPair()
    writeFileSync(priv, k.privateKeyPem, { mode: 0o600 })
    writeFileSync(pub, k.publicKeyPem, { mode: 0o644 })
    chmodSync(priv, 0o600)
  }
  const problem = permissionProblem(priv, 'private key', 'file')
  if (problem) throw new Error(problem)
  const privateKeyPem = readFileSync(priv, 'utf8')
  const publicKeyPem = existsSync(pub) ? readFileSync(pub, 'utf8') : generateFromPrivate(privateKeyPem, pub)
  let runnerId: string | null = null
  const state = join(dir, FILES.state)
  if (existsSync(state)) { try { runnerId = (JSON.parse(readFileSync(state, 'utf8')) as { runnerId?: string }).runnerId ?? null } catch { runnerId = null } }
  return { privateKeyPem, publicKeyPem, fingerprint: keyFingerprint(publicKeyPem), runnerId }
}

function generateFromPrivate(privateKeyPem: string, pubPath: string): string {
  const pem = createPublicKey(createPrivateKey(privateKeyPem)).export({ type: 'spki', format: 'pem' }) as string
  writeFileSync(pubPath, pem, { mode: 0o644 })
  return pem
}

export function saveRunnerId(dir: string, runnerId: string): void {
  writeFileSync(join(dir, FILES.state), JSON.stringify({ runnerId }), { mode: 0o600 })
}
