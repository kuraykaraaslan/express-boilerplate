/**
 * The job-data secret guard (P9-5).
 *
 * A BullMQ job's data is stored in Redis as plain JSON for as long as the queue keeps the job: a completed or failed job stays
 * for its retention window (the webhook queue kept its failed jobs 14 days), a failed one is shown by the queue inspector, and
 * every Redis snapshot or replica holds a copy. A signing secret, a password or a token placed in job data therefore lives
 * outside its encrypted column, unrotated, for days. The rule: a job carries ids, and its worker re-loads the secret by id
 * when it runs.
 *
 * This guard is the shared backstop of that rule. `installJobSecretGuard` (installed when `redis.bullmq` loads, which every
 * queue of the platform imports for its connection) wraps `Queue.prototype.add` and `addBulk`, so a job whose data holds a
 * secret-named key at any depth, or a value that is a PEM private key, is refused before it reaches Redis. The error names
 * the queue and the key path, never the value.
 *
 * What it cannot see: a secret under an innocent key name (a token inside a mail body is the message itself and is not
 * judged). The inventory test (`redis.job-secrets.inventory.test.ts`) lists every queue and the shape of its data, so a new
 * queue is reviewed when it is added.
 */

/** Key names (lower-cased, `_`/`-`/`.` removed) that hold a secret wherever they appear. */
const SECRET_KEY_PARTS = [
  'secret',
  'password',
  'passwd',
  'passphrase',
  'apikey',
  'privatekey',
  'credential',
  'authorization',
  'cookie',
  'signingkey',
  'encryptionkey',
];

/** `accessToken`, `refreshToken`, `pushToken`, `token`, but not `maxTokens` or `tokenCount`. */
const TOKEN_SUFFIX = /token$/;

const PEM_PRIVATE_KEY = /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/;

const MAX_DEPTH = 12;

function normalise(key: string): string {
  return key.toLowerCase().replace(/[-_.\s]/g, '');
}

/** True when `key` names a secret (case and separators ignored). */
export function isSecretKeyName(key: string): boolean {
  const k = normalise(key);
  return SECRET_KEY_PARTS.some((p) => k.includes(p)) || TOKEN_SUFFIX.test(k);
}

/** Thrown when a job's data would carry a secret into Redis. Names the queue and the path, never the value. */
export class JobDataSecretError extends Error {
  readonly code = 'JOB_DATA_SECRET';
  constructor(readonly queueName: string, readonly path: string, readonly reason: 'key' | 'value') {
    super(
      reason === 'key'
        ? `[queue:${queueName}] job data must not carry a secret: key "${path}" is secret-named; enqueue the id and re-load the secret in the worker`
        : `[queue:${queueName}] job data must not carry a secret: the value at "${path}" is a private key; enqueue the id and re-load it in the worker`,
    );
    this.name = 'JobDataSecretError';
  }
}

/** The first secret found in `data`, as its path, or null. Walks plain objects and arrays; cycles and depth are bounded. */
export function findJobDataSecret(data: unknown): { path: string; reason: 'key' | 'value' } | null {
  const seen = new WeakSet<object>();
  const walk = (value: unknown, path: string, depth: number): { path: string; reason: 'key' | 'value' } | null => {
    if (typeof value === 'string') return PEM_PRIVATE_KEY.test(value) ? { path: path || '(root)', reason: 'value' } : null;
    if (value === null || typeof value !== 'object' || depth > MAX_DEPTH) return null;
    if (seen.has(value)) return null;
    seen.add(value);
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const hit = walk(value[i], `${path}[${i}]`, depth + 1);
        if (hit) return hit;
      }
      return null;
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key;
      // A secret-named key is refused even when its value is empty: the shape itself is the defect.
      if (isSecretKeyName(key) && child !== undefined) return { path: childPath, reason: 'key' };
      const hit = walk(child, childPath, depth + 1);
      if (hit) return hit;
    }
    return null;
  };
  return walk(data, '', 0);
}

/** Throws `JobDataSecretError` when `data` carries a secret. */
export function assertNoSecretsInJobData(queueName: string, data: unknown): void {
  const hit = findJobDataSecret(data);
  if (hit) throw new JobDataSecretError(queueName, hit.path, hit.reason);
}

const GUARDED = Symbol.for('nb.bullmq.jobSecretGuard');

type AddFn = (name: string, data: unknown, opts?: unknown) => Promise<unknown>;
type AddBulkFn = (jobs: Array<{ name: string; data: unknown; opts?: unknown }>) => Promise<unknown>;

/**
 * Wraps `add` and `addBulk` of a Queue class's prototype so every queue built from it refuses secret-carrying job data.
 * Idempotent per prototype. A class without a prototype `add` (a test double) is left alone. Returns whether it is guarded.
 */
export function installJobSecretGuard(QueueClass: unknown): boolean {
  const proto = (QueueClass as { prototype?: Record<string | symbol, unknown> } | null)?.prototype;
  if (!proto) return false;
  if (proto[GUARDED]) return true;
  if (typeof proto.add !== 'function') return false;
  const add = proto.add as AddFn;
  proto.add = function guardedAdd(this: { name?: string }, name: string, data: unknown, opts?: unknown) {
    try {
      assertNoSecretsInJobData(this?.name ?? 'unknown', data);
    } catch (e) {
      return Promise.reject(e);
    }
    return add.call(this, name, data, opts);
  };
  if (typeof proto.addBulk === 'function') {
    const addBulk = proto.addBulk as AddBulkFn;
    proto.addBulk = function guardedAddBulk(this: { name?: string }, jobs: Array<{ name: string; data: unknown; opts?: unknown }>) {
      try {
        for (const j of jobs ?? []) assertNoSecretsInJobData(this?.name ?? 'unknown', j?.data);
      } catch (e) {
        return Promise.reject(e);
      }
      return addBulk.call(this, jobs);
    };
  }
  proto[GUARDED] = true;
  return true;
}
