/**
 * Contracts of the points `announcement` declares (module.json `extensionPoints`), so it never imports the modules that
 * know about plans, editions or status-page subscribers.
 */

/** Extension point ids. */
export const AUDIENCE_FACET_POINT = 'announcement:audience_facet';
export const MAIL_COVERAGE_POINT = 'announcement:mail_coverage';

/** One choice of a facet in the composer: a plan, an edition. */
export interface AudienceFacetOption {
  value: string;
  label: string;
}

/**
 * An audience axis another module knows (D18): `plan` (tenant_subscription: the tenants on a plan), `edition`
 * (module_lifecycle: the tenants using a module of an edition). The contribution's `key` is the facet id the audience
 * stores its values under. Platform announcements only.
 */
export interface AudienceFacetProvider {
  /** The choices the composer offers. */
  options(): Promise<AudienceFacetOption[]>;
  /** The tenants that match ANY of `values`. */
  tenantsMatching(values: string[]): Promise<string[]>;
}

/** A maintenance notice that is about to go out by mail, as a coverage provider is asked about it. */
export interface MailCoverageQuery {
  tenantId: string;
  windowId: string;
  /** The notice: the start of a workspace's window (the one moment the status page mails its subscribers about too). */
  stage: 'start';
  /** The addresses the notice would mail (lower case). */
  emails: string[];
}

/**
 * Says which addresses another module already mails about the same maintenance moment, so a person gets ONE mail (the
 * status page mails its subscribers when a workspace's window starts; a subscriber who is also a user is left out of the
 * start notice's mail). Answers a subset of `emails`; anything else, or a failure, leaves the list as it is.
 */
export interface MailCoverageProvider {
  coveredAddresses(query: MailCoverageQuery): Promise<string[]>;
}
