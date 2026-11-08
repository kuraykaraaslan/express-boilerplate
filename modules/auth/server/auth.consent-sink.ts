import 'reflect-metadata';
import { ext, systemCtx, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext';
import { authConsentSinkLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/auth.consent_sink';
import Logger from '@kuraykaraaslan-labs/logger';
import { withSystemRLS, withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { UserConsent as UserConsentEntity } from './entities/user_consent.entity';

/**
 * `auth:consent_sink` — where "this person agreed to this" gets written.
 *
 * ## Why a seam instead of a merge
 *
 * The repo had two consent ledgers with zero references between them
 * (audit 2026-08, DUP-03): `auth.user_consents`, written at registration and by
 * the SSO / national-id just-in-time provisioning flows, and
 * `terms_consent.agreement_acceptances`, written at checkout and by the cookie
 * banner, with content hashes, verbatim snapshots and level-of-assurance. No
 * data was lost by having both — the defect is fragmentation: "what did user U
 * consent to?" spans two incompatible schemas, and that question is the entire
 * point of a KVKK/GDPR request.
 *
 * `terms_consent` is the ledger that survives. But the auth family CANNOT
 * hard-require it: a deployment that sells no agreements still has to be able to
 * register a user, and AGENTS.md §10 makes standalone installability
 * non-negotiable for a core module. So the arrow is inverted — `auth` declares
 * the sink, `terms_consent` contributes the real implementation, and with no
 * contributor present auth keeps writing exactly the row it writes today.
 *
 * The consequence worth being explicit about: with `terms_consent` installed
 * there is ONE ledger; without it there is one ledger that happens to be the
 * lightweight one. What can no longer happen is two ledgers filling up in
 * parallel with nobody joining them.
 *
 * ## Best-effort, always
 *
 * Every call site here is on a registration path. A consent write must never
 * block someone from creating an account — the row is evidence, and losing one
 * row is recoverable in a way that a failed signup is not. Failures are logged
 * and swallowed at the boundary.
 */

/** Extension point id — declared in auth/module.json `extensionPoints`. */
export const AUTH_CONSENT_SINK_POINT = 'auth:consent_sink';

/** Where the consent happened, for the audit trail. */
export interface ConsentContext {
  tenantId?: string | null;
  locale?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  /** Free-form origin marker, e.g. 'registration', 'sso:google'. */
  source?: string | null;
}

/**
 * Agreement to a DOCUMENT — terms of service, privacy policy — identified by a
 * version label rather than a content hash.
 *
 * A registration-time consent genuinely has no hash: the user ticked a box next
 * to a link, and the deployment may not have an `Agreement` row at all. That is
 * a WEAKER record than a checkout acceptance and the ledger marks it as such
 * rather than pretending otherwise.
 */
export interface DocumentConsentEvent {
  kind: 'DOCUMENT';
  userId: string;
  /** 'terms_of_service' | 'privacy_policy' | … — free-form, as today. */
  documentType: string;
  /** Version label the user agreed to, e.g. '2026-01-01', 'v3'. */
  documentVersion: string;
  context?: ConsentContext;
}

/**
 * Grant or withdrawal of a PURPOSE — marketing, newsletter, analytics. Not a
 * document: there is nothing to hash, only a decision with a timestamp.
 */
export interface PurposeConsentEvent {
  kind: 'PURPOSE';
  userId: string;
  /** Matches terms_consent's consent purposes, e.g. 'marketing'. */
  purpose: string;
  granted: boolean;
  context?: ConsentContext;
}

export type ConsentEvent = DocumentConsentEvent | PurposeConsentEvent;

/** What a contributor implements. Returns false to fall back to the local row. */
export type ConsentSink = (event: ConsentEvent) => Promise<boolean>;

/**
 * Record a consent event.
 *
 * Tries the contributed ledger first; falls back to auth's own `user_consents`
 * table when nothing is contributed (or the ledger's module is not active for the
 * tenant), when the contribution declines, or when it fails. Purpose events have
 * no local equivalent — `user_consents` only models documents — so those are
 * simply not recorded when no ledger is installed, which is the honest outcome:
 * the caller's own boolean column is still the state, this was only ever the
 * evidence trail.
 *
 * A PURPOSE event has no local fallback, so a ledger that throws gets one retry
 * (inside its call, within the point's budget) before the evidence is lost; a
 * ledger that could not be loaded or did not answer in time is not retried.
 *
 * Never throws.
 *
 * @param _enabledIds @deprecated — gating happens in common/server/extensions.
 */
export async function recordConsent(event: ConsentEvent, _enabledIds?: Set<string>): Promise<void> {
  try {
    const tenantId = event.context?.tenantId;
    // Self-registration happens before any tenant exists: nothing to gate by.
    const ctx = tenantId ? tenantCtx(tenantId) : systemCtx('consent recorded before any tenant exists');
    const attempts = event.kind === 'PURPOSE' ? 2 : 1;
    const answered = new Set<string>();
    const claimed = await ext.first<ConsentSink, true>(
      AUTH_CONSENT_SINK_POINT, ctx, authConsentSinkLoaders,
      async (sink, _signal, contribution) => {
        for (let attempt = 1; ; attempt++) {
          try {
            const taken = await sink(event);
            answered.add(contribution.id);
            return taken ? true : null; // declined: the next contributor is asked, no retry
          } catch (error) {
            if (attempt >= attempts) throw error;
            Logger.warn(`[auth.consentSink][${contribution.moduleId}] attempt ${attempt}: ${error instanceof Error ? error.message : error}`);
          }
        }
      },
    );
    if (claimed) return;
    if (event.kind === 'DOCUMENT') {
      await writeLocalDocumentConsent(event);
      return;
    }
    // Every active ledger was asked; one that did not answer (load failure, throw after the retry, timeout, or paused
    // by the runtime after repeated errors) failed.
    const failedSinks = (await ext.states(AUTH_CONSENT_SINK_POINT, ctx))
      .filter((s) => s.state === 'active' && !answered.has(s.contribution.id))
      .map((s) => s.contribution);
    if (failedSinks.length) {
      // An installed ledger failed and nothing else holds this decision. Logged as an error with a stable marker
      // and the decision itself, so it can be found and re-entered; the caller's own column still holds the state.
      Logger.error(
        `[auth.consentSink] CONSENT_EVIDENCE_LOST sink=${failedSinks.map((c) => c.moduleId).join(',')} userId=${event.userId} purpose=${event.purpose} ` +
        `granted=${event.granted} source=${event.context?.source ?? '-'} at=${new Date().toISOString()}`,
      );
    }
  } catch (error) {
    Logger.warn(`[auth.consentSink] consent not recorded for ${event.userId}: ${error instanceof Error ? error.message : error}`);
  }
}

/**
 * The pre-2026-08 write, still the fallback when no ledger is contributed.
 *
 * `tenantId` is nullable because self-registration happens before any tenant
 * context exists — that row genuinely has no tenant database to live in, and
 * stays on the SYSTEM datasource exactly as it always has.
 *
 * When a tenant IS known (SSO / national-id just-in-time provisioning), the
 * row now goes through `withTenantRepositoryFor` (docs/phases/10-db Faz 3) instead of
 * `getDataSource()`. That is not only RLS-readiness: a tenant with a row in
 * `tenant_databases` lives in its OWN database, and the old unconditional
 * `getDataSource()` call was writing every consent row into the shared
 * database regardless — silently wrong for a dedicated-database tenant, a
 * real bug this migration also fixes, not just a chokepoint formality.
 * `UserConsent` is written nowhere else and read nowhere else in the tree
 * (grep-verified), so moving the tenant-scoped rows into their own tenant's
 * database strands no other reader.
 */
async function writeLocalDocumentConsent(event: DocumentConsentEvent): Promise<void> {
  const tenantId = event.context?.tenantId ?? null;
  const row = {
    userId: event.userId,
    tenantId,
    documentType: event.documentType,
    documentVersion: event.documentVersion,
    locale: event.context?.locale ?? null,
    ipAddress: event.context?.ipAddress ?? null,
    userAgent: event.context?.userAgent ?? null,
  };
  if (tenantId) {
    await withTenantRepositoryFor(tenantId, UserConsentEntity, (repo) => repo.save(repo.create(row)));
    return;
  }
  // No tenant on the consent (an account-level acceptance): written on the system connection, a runtime login with no tenant context could not insert it once RLS is forced.
  await withSystemRLS((qr) => { const repo = qr.manager.getRepository(UserConsentEntity); return repo.save(repo.create(row)); });
}
