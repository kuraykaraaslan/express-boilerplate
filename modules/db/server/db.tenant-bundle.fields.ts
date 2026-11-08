/**
 * Field-encrypted values across a migration (docs/phases/02-fleet/05 sections 6.3 and 6.4). A node encrypts sensitive columns with ITS OWN field key
 * (`SETTINGS_ENCRYPTION_KEY`, one random value per node: infra/compose/secrets/secrets.list), so a value copied byte for byte from the source would be
 * unreadable on the target. The bundle therefore carries such values in a key-neutral TRANSPORT form: the source decrypts every field-encryption
 * envelope (`v1.<iv>.<ciphertext>.<tag>`, common/server/field-encryption.ts) into `fleetf1.<base64url(plaintext)>`, and the target encrypts it again
 * under its own key before the row is written. The plaintext only ever travels inside the bundle, which is sealed to the target's attested key.
 *
 * The rewrite works on the canonical row text (`to_jsonb(row)::text`) string token by string token and never parses the row, so numbers keep every
 * digit (the bundle's "lossless by construction" rule). A string that merely BEGINS with one of the two reserved prefixes is escaped
 * (`fleetf0.<base64url(its raw JSON text)>`), so no value is ever mistaken for a transported field. An envelope the source cannot open (written under
 * another key, damaged) stays exactly as it is and is counted: it is as unreadable on the target as it already was on the source.
 *
 * The target's verification re-exports through the same transport, so a lossless import compares equal although the ciphertexts differ.
 */

/**
 * A field-encryption envelope (`v1.<iv>.<ct>.<tag>`, or `v2.<kid>.<iv>.<ct>.<tag>` under a named key such as a tenant key): parts whose base64url
 * alphabet never needs JSON escaping, so the token's raw text is the stored value. A v2 envelope under a tenant key is opened by the codec the export
 * gets from db.tenant-keys.service.ts `exportCodec` (the tenant's keys held for the whole export; the export is refused for a key of the tenant it
 * cannot open); only a value under a key destroyed for good, another tenant's key, or a damaged one is counted unreadable.
 */
const ENVELOPE_RE = /^(v1|v2\.[A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+$/;
/** A decrypted field in transport: base64url of its UTF-8 plaintext. */
export const FIELD_TRANSPORT_PREFIX = 'fleetf1.';
/** A literal string that began with a reserved prefix: base64url of its raw JSON token text. */
export const FIELD_LITERAL_PREFIX = 'fleetf0.';

export interface FieldCodec {
  /** The plaintext of an envelope, or null when this node's key cannot open it. */
  decrypt(envelope: string): string | null;
  /** A fresh envelope of `plaintext` under this node's key; throws when the node has no field key. */
  encrypt(plaintext: string): string;
}

export interface FieldCounts { reencrypted: number; unreadable: number }

/** Rewrites every JSON string token (keys and values) of one canonical JSON text through `f`, which receives and returns RAW token text. */
export function mapJsonStrings(text: string, f: (raw: string) => string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('"', i);
    if (open < 0) { out += text.slice(i); break; }
    out += text.slice(i, open);
    let j = open + 1;
    while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
    if (j >= text.length) throw new Error('tenant bundle: unterminated string in a row');
    out += `"${f(text.slice(open + 1, j))}"`;
    i = j + 1;
  }
  return out;
}

const reserved = (raw: string) => raw.startsWith(FIELD_TRANSPORT_PREFIX) || raw.startsWith(FIELD_LITERAL_PREFIX);

/** The source's side: one canonical row text into its transport form; `counts` accumulates. */
export function fieldsToTransport(line: string, codec: FieldCodec, counts: FieldCounts): string {
  return mapJsonStrings(line, (raw) => {
    if (ENVELOPE_RE.test(raw)) {
      const plain = codec.decrypt(raw);
      if (plain === null) { counts.unreadable++; return raw; }
      counts.reencrypted++;
      return FIELD_TRANSPORT_PREFIX + Buffer.from(plain, 'utf8').toString('base64url');
    }
    return reserved(raw) ? FIELD_LITERAL_PREFIX + Buffer.from(raw, 'utf8').toString('base64url') : raw;
  });
}

/** The target's side: one transport row text back into a row text for this node, every transported field encrypted under this node's key. */
export function fieldsFromTransport(line: string, codec: FieldCodec): string {
  return mapJsonStrings(line, (raw) => {
    if (raw.startsWith(FIELD_TRANSPORT_PREFIX)) return codec.encrypt(Buffer.from(raw.slice(FIELD_TRANSPORT_PREFIX.length), 'base64url').toString('utf8'));
    if (raw.startsWith(FIELD_LITERAL_PREFIX)) return Buffer.from(raw.slice(FIELD_LITERAL_PREFIX.length), 'base64url').toString('utf8');
    return raw;
  });
}
