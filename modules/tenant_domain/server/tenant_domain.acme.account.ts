import crypto from 'node:crypto';
import { withSystemRLS } from '@kuraykaraaslan-labs/db';
import { encryptField, decryptField } from '@kuraykaraaslan-labs/common/server/field-encryption';
import { TenantDomainAcmeAccount } from './entities/tenant_domain_acme_account.entity';

/**
 * The platform's account key at one authority: read, or created on the first order. Two workers racing at that moment both insert, the
 * unique index keeps one, and both read the winner back, so the process never orders under a key that was not stored.
 */
export async function loadOrCreateAccountKeyPem(directoryUrl: string, contactEmail: string | null): Promise<string> {
  const read = () => withSystemRLS((qr) => qr.manager.getRepository(TenantDomainAcmeAccount).findOne({ where: { directoryUrl } }));
  const existing = await read();
  if (existing) return decryptField(existing.accountKeyEnc);
  const fresh = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  await withSystemRLS((qr) => qr.manager.getRepository(TenantDomainAcmeAccount).createQueryBuilder().insert()
    .values({ directoryUrl, accountKeyEnc: encryptField(fresh), contactEmail })
    .orIgnore().execute());
  const winner = await read();
  if (!winner) throw new Error('acme: the account key could not be stored');
  return decryptField(winner.accountKeyEnc);
}
