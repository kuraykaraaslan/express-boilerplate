import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import { canonicalize } from './canonical';
import { openSealedString, seal } from './seal';
import { TenantInitSchema, type TenantInit } from './tenant-init.schema';

/**
 * What `tenant.provision` carries about a NEW tenant that the control plane must never hold in the clear (docs/phases/02-fleet/03 section 8.10, 05
 * section 4): its slug, its owner's e-mail and its display name, sealed to the home node's encryption key (`NODE_ENC`, X25519). The directory row and the
 * command row hold only the sealed string; the node opens it with the key only it has. A box that does not open, or opens to anything but this exact
 * shape, is refused: the node never creates a tenant from a guess.
 */
export { TENANT_SLUG_RE, TenantInitSchema, type TenantInit } from './tenant-init.schema';

/** Seals a validated init to the node's encryption public key (PEM or KeyObject). Throws on an invalid init or key. */
export function sealTenantInit(init: TenantInit, nodeEncryptionPublicKey: string | KeyObject): string {
  const parsed = TenantInitSchema.parse(init);
  const key = typeof nodeEncryptionPublicKey === 'string' ? createPublicKey(nodeEncryptionPublicKey) : nodeEncryptionPublicKey;
  return seal(canonicalize(parsed), key);
}

/** Opens a sealed init with the node's encryption private key (PEM or KeyObject). Null for anything that does not open or does not parse exactly. */
export function openTenantInit(sealed: string, nodeEncryptionPrivateKey: string | KeyObject): TenantInit | null {
  let key: KeyObject;
  try { key = typeof nodeEncryptionPrivateKey === 'string' ? createPrivateKey(nodeEncryptionPrivateKey) : nodeEncryptionPrivateKey; } catch { return null; }
  const text = openSealedString(sealed, key);
  if (text === null) return null;
  try {
    const parsed = TenantInitSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}
