import { createHash } from 'node:crypto';

/** JSON with every object's keys in order, so equal documents give equal text whatever order Postgres (jsonb reorders keys) or a client sent the keys in. */
export function canonicalJson(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return JSON.stringify(walk(value));
}

/**
 * The fingerprint of a scene document (SF-2): the SHA-256 (hex) of its canonical JSON, computed by the SERVER from the document it stores, never taken from a
 * client. A binding stores the document's fingerprint when it is saved and the cards and the drawer compare it with the document's current one to tell that the
 * drawing changed (TK-6, SM-12), so every kind that stores a document computes it with this one function, on every path that writes the document: a save,
 * a create, the seed. The same document gives the same fingerprint whatever wrote it; a changed one a different one.
 */
export const documentFingerprint = (document: unknown): string => createHash('sha256').update(canonicalJson(document)).digest('hex');
