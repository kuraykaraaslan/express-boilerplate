/**
 * Canonical JSON for signing (03 §2): keys sorted, no whitespace, UTF-8, integers only.
 * Anything that could serialise ambiguously (floats, NaN, undefined, non-plain objects) throws,
 * so a signer and a verifier can never disagree about the bytes.
 */
export class CanonicalError extends Error {}

export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isSafeInteger(value)) throw new CanonicalError('only safe integers are allowed');
      return String(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) throw new CanonicalError('only plain objects are allowed');
      const obj = value as Record<string, unknown>;
      const parts = Object.keys(obj)
        .sort()
        .map((k) => {
          if (obj[k] === undefined) throw new CanonicalError(`undefined value at "${k}"`);
          return `${JSON.stringify(k)}:${canonicalize(obj[k])}`;
        });
      return `{${parts.join(',')}}`;
    }
    default:
      throw new CanonicalError(`unsupported type ${typeof value}`);
  }
}

export function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(canonicalize(value), 'utf8');
}
