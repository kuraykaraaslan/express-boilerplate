import { FieldDecryptError } from '@kuraykaraaslan-labs/common/server/field-encryption';
import { tenantKeys } from '@kuraykaraaslan-labs/db/server/db.tenant-keys.service';

/**
 * The signing secrets of a webhook under its tenant's data key (P7-TDEK, decision F16; declared in webhook.tenant-key-columns.ts).
 *
 *  - Write: `sealWebhookSecret` seals a new secret under the tenant's ACTIVE key BEFORE the tenant transaction opens (the key service may unwrap
 *    or create the key on the control database). The entity's `encryptedColumnTransformer` stays as the safety net: it writes a tenant envelope
 *    back unchanged and seals a plaintext a forgotten writer hands it under the node key (never in clear).
 *  - Read: `openWebhookSecrets` opens the columns through the tenant-checked reader (dual read: a legacy plaintext, a v1 envelope the transformer
 *    already opened, a node-key envelope and a tenant envelope of THIS tenant all open). A value that does not open (another tenant's key, a
 *    destroyed key, damage) is handed on AS ITS ENVELOPE, which the delivery refuses to sign with (`SECRET_UNREADABLE`) or drops (the previous one).
 */
export async function sealWebhookSecret(tenantId: string, secret: string): Promise<string> {
  return tenantKeys.encryptOpt(tenantId, secret);
}

async function open(tenantId: string, value: string): Promise<string> {
  try {
    return await tenantKeys.decrypt(tenantId, value);
  } catch (e) {
    if (e instanceof FieldDecryptError) return value;
    throw e;
  }
}

export async function openWebhookSecrets(
  webhook: { tenantId: string; secret: string; previousSecret?: string | null },
  opts: { withPrevious?: boolean } = {},
): Promise<{ secret: string; previousSecret: string | null }> {
  const secret = await open(webhook.tenantId, webhook.secret);
  const previousSecret = opts.withPrevious !== false && webhook.previousSecret ? await open(webhook.tenantId, webhook.previousSecret) : null;
  return { secret, previousSecret };
}
