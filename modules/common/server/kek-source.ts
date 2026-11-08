import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { ageDecrypt, isAgeFile, parseAgeIdentityFile } from './age';
import { parseKek } from './key-wrap';

/**
 * Where the 32-byte region KEK comes from (X4-7; docs/phases/02-fleet/04 section 3, L1). One loader for every consumer: the fleet agent's
 * private-key wrapping (`fleet_agent/server/agent.kek.ts`) and the db module's `file` tenant key provider (`db.key-provider.ts`, P7-TDEK).
 *
 * Two storage forms are built, both read from the configured KEK file on every use (nothing is cached, so a rotated file applies at once):
 *
 *  - `plain`: the file holds the KEK itself, 32 raw bytes or 64 hex characters (the form so far).
 *  - `age`: the file is an age v1 file (binary or armored) sealed to an X25519 identity of the regional partner, and holds the KEK in one of the
 *    two plain forms. It opens only with the identity file the deployment names (an `AGE-SECRET-KEY-1...` file; on a small install it lives on
 *    an HSM-backed or separate host and is mounted read-only). A copy of the secrets volume without that identity is inert.
 *
 * Fail-closed rules: an age-encrypted KEK without a configured identity file is refused (never guessed), and a configured identity file with a
 * plain KEK file is refused too, so taking the identity away from a deployment that expects it cannot silently downgrade it to a cleartext KEK.
 *
 * The regional KMS and Vault transit are interfaces only (`RemoteKekPort`): they need a provider account to build and test against.
 */

export type KekStorage = 'plain' | 'age';

export interface KekSourceOptions {
  /** The age identity file that opens an age-encrypted KEK file. When set, the KEK file MUST be age-encrypted. */
  ageIdentityFile?: string;
  /** Returns a problem with a secret file (e.g. group/other readable), or null; called for the KEK file and the identity file. */
  checkPath?: (path: string, label: string) => string | null;
}

/** The `label` `loadKekFile` passes to `checkPath` for the age identity file (the KEK file is `'KEK file'`). */
export const AGE_IDENTITY_FILE_LABEL = 'age identity file';

/**
 * A `checkPath` for callers outside the agent (which has `agent.perms`): a file group or other can access is refused. POSIX only (Windows has no
 * comparable mode bits); a missing file is left to the caller's own read, which reports it.
 */
export function ownerOnlyProblem(path: string, label: string): string | null {
  if (process.platform === 'win32') return null;
  let mode: number;
  try { mode = statSync(/*turbopackIgnore: true*/ path).mode; } catch { return null; }
  if ((mode & 0o077) === 0) return null;
  return `${label} ${path} is accessible by group/other (mode ${(mode & 0o777).toString(8).padStart(3, '0')}): run chmod 600 on it`;
}

export class KekSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KekSourceError';
  }
}

/** Reads the KEK file's storage form without opening it. */
export function kekStorageOf(contents: Buffer): KekStorage {
  return isAgeFile(contents) ? 'age' : 'plain';
}

/** Loads the region KEK from `kekFile`, opening it with the age identity when it is age-encrypted. Throws `KekSourceError`. */
export function loadKekFile(kekFile: string, opts: KekSourceOptions = {}): Buffer {
  // The KEK and age identity paths come from the environment at run time: `turbopackIgnore` keeps the build from tracing the whole
  // project into the standalone release because of them (every release carried the repo, logs and server scratch files until 2026-11-04).
  const path = resolve(/*turbopackIgnore: true*/ kekFile);
  const problem = opts.checkPath?.(path, 'KEK file');
  if (problem) throw new KekSourceError(problem);
  let contents: Buffer;
  try { contents = readFileSync(/*turbopackIgnore: true*/ path); } catch (e) { throw new KekSourceError(`cannot read KEK file: ${(e as Error).message}`); }
  const storage = kekStorageOf(contents);
  if (storage === 'plain') {
    if (opts.ageIdentityFile) throw new KekSourceError('an age identity file is configured but the KEK file is not age-encrypted: refusing a cleartext KEK');
    try { return parseKek(contents); } catch (e) { throw new KekSourceError((e as Error).message); }
  }
  if (!opts.ageIdentityFile) throw new KekSourceError('the KEK file is age-encrypted: configure the age identity file that opens it');
  const idPath = resolve(/*turbopackIgnore: true*/ opts.ageIdentityFile);
  const idProblem = opts.checkPath?.(idPath, AGE_IDENTITY_FILE_LABEL);
  if (idProblem) throw new KekSourceError(idProblem);
  let identities;
  try { identities = parseAgeIdentityFile(readFileSync(/*turbopackIgnore: true*/ idPath, 'utf8')); } catch (e) { throw new KekSourceError(`cannot use age identity file: ${(e as Error).message}`); }
  let plain: Buffer;
  try { plain = ageDecrypt(contents, identities); } catch (e) { throw new KekSourceError(`cannot open the age-encrypted KEK file: ${(e as Error).message}`); }
  try { return parseKek(plain); } catch (e) { throw new KekSourceError(`the age-encrypted KEK file does not hold a KEK: ${(e as Error).message}`); } finally { plain.fill(0); }
}

/**
 * The regional KMS / Vault transit form of the region KEK: the KEK file would hold the KEK encrypted by a key that never leaves the KMS, and this
 * port asks the KMS to open it (`context` is bound as the KMS encryption context / Vault `context`). Interface only (X4-7): an adapter needs the
 * regional provider's account, endpoint and credentials, and its callers would load the KEK once at start, since a KMS round trip is async.
 */
export interface RemoteKekPort {
  readonly kind: 'kms' | 'vault';
  decryptKek(ciphertext: Buffer, context: Record<string, string>): Promise<Buffer>;
}

/** Selecting a KMS / Vault KEK source before an adapter exists refuses loudly instead of falling back to another source. */
export function unimplementedRemoteKek(kind: 'kms' | 'vault'): RemoteKekPort {
  return {
    kind,
    decryptKek: async () => { throw new KekSourceError(`the ${kind} region KEK source is not implemented yet: use a plain or age-encrypted KEK file`); },
  };
}
