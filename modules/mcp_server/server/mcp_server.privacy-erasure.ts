/**
 * `privacy:erasure` contribution (docs/phases/57-mcp-server): a person's MCP OAuth grants (the AI apps they connected, with the app's
 * host and when it was last used) are deleted; a deleted grant's tokens answer nothing from then on. The audit rows follow the audit
 * log's own erasure. `dryRun` counts and changes nothing.
 */
import type { ErasureOutcome, PrivacySubject } from '@kuraykaraaslan-labs/common/server/common.privacy-contracts';
import { oauthStore } from './oauth/mcp_oauth.store';

const erasureProvider = {
  subjectTypes: ['user'],
  async erase(tenantId: string, subject: PrivacySubject, options: { dryRun: boolean }): Promise<ErasureOutcome> {
    const userId = subject.identifiers.userId ?? (subject.subjectType === 'user' ? subject.subjectId : null);
    if (!userId) return { erased: 0, retained: 0, mode: 'ERASE' };
    const erased = options.dryRun ? await oauthStore.grantsOfUser(tenantId, userId) : await oauthStore.deleteGrantsOfUser(tenantId, userId);
    return { erased, retained: 0, mode: 'ERASE' };
  },
};

export default erasureProvider;
