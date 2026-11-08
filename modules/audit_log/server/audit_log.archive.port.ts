import { ContributionFailedError, ext, systemCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext';
import { auditLogArchiveExporterLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/audit_log.archive_exporter';
import type { AuditArchiveExporter } from './audit_log.types';

/**
 * Where the rows of a retention purge are written before they are deleted (docs/phases/02-fleet/04-security-model.md section 7, "Export"). The destination is not
 * this module's business (an object store with object lock, a log aggregator), so it arrives through the provider extension point `audit_log:archive_exporter`;
 * `audit_log` imports none of its providers. A contribution default-exports `() => Promise<AuditArchiveExporter | null>`: the exporter when its destination is
 * configured, null when it is not.
 *
 * Three outcomes, kept apart on purpose:
 *  - no contribution, or every one answers null: `null`, no archive. The purge proceeds and the chain stays provable through its checkpoint;
 *  - a contribution answers an exporter: that one is used (the first, in extension order);
 *  - a contribution THROWS (or times out, or cannot be loaded) or answers something that is not an exporter: this function THROWS. The operator meant to
 *    keep these rows, so the sweep must not delete them just because the destination could not be reached. The point is declared fail-closed, so the host
 *    runtime stops at that contribution with ContributionFailedError; this module answers its own error, without the provider's text.
 *
 * The destination is the platform's, resolved once per sweep for every tenant: a system context, every installed contribution is asked.
 */
export const ARCHIVE_EXPORTER_POINT = 'audit_log:archive_exporter';

export type ArchiveExporterProvider = () => Promise<AuditArchiveExporter | null>;

export class ArchiveExporterUnavailableError extends Error {
  constructor() { super('The audit archive exporter could not be resolved'); this.name = 'ArchiveExporterUnavailableError'; }
}

const isExporter = (v: unknown): v is AuditArchiveExporter => typeof v === 'object' && v !== null && typeof (v as AuditArchiveExporter).export === 'function';

/** The narrow port the purge sweep reads; tests and embedders replace it with `setArchiveExporterResolver`. */
export type ArchiveExporterResolver = () => Promise<AuditArchiveExporter | null>;

/** What a provider threw, reduced to its name: the host runtime logs the failure, and a destination's error text may carry credentials. */
class ExporterFailed extends Error {
  constructor(error: unknown) { super(error instanceof Error ? error.name : 'error'); this.name = 'ExporterFailed'; }
}

const SWEEP_CTX = systemCtx('audit retention sweep: one archive destination for every tenant');

export const extensionArchiveExporterResolver: ArchiveExporterResolver = async () => {
  // A contribution the host runtime holds back (paused by its breaker) is a destination that cannot be reached, never "no archive".
  const [asked, installed] = await Promise.all([ext.contributions(ARCHIVE_EXPORTER_POINT, SWEEP_CTX), ext.states(ARCHIVE_EXPORTER_POINT, SWEEP_CTX)]);
  if (asked.length < installed.length) throw new ArchiveExporterUnavailableError();
  try {
    const found = await ext.first<ArchiveExporterProvider, AuditArchiveExporter>(
      ARCHIVE_EXPORTER_POINT, SWEEP_CTX, auditLogArchiveExporterLoaders,
      async (provider) => {
        let answer: unknown;
        try { answer = await provider(); } catch (error) { throw new ExporterFailed(error); }
        if (answer === null) return null;                               // not configured: ask the next one
        if (!isExporter(answer)) throw new Error('the answer is not an exporter');
        return answer;
      },
    );
    return found?.value ?? null;
  } catch (error) {
    if (error instanceof ContributionFailedError) throw new ArchiveExporterUnavailableError();
    throw error;
  }
};

let current: ArchiveExporterResolver | null = null;
export function setArchiveExporterResolver(resolver: ArchiveExporterResolver | null): void { current = resolver; }
export function resolveArchiveExporter(): Promise<AuditArchiveExporter | null> { return (current ?? extensionArchiveExporterResolver)(); }
