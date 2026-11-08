import type { SettingFieldDef } from '@kuraykaraaslan-labs/tenant_setting/server/setting-fields.types';

// UI metadata for the Domains settings page. Keys are already read per-tenant
// by tenant_domain.service.ts via SettingService.getByKey(tenantId, ...).
export const TENANT_DOMAIN_SETTINGS_FIELDS: SettingFieldDef[] = [
  {
    key: 'maxDomains',
    label: 'Max Custom Domains',
    description: 'Maximum number of custom domains for this organization. Leave blank for the system default.',
    group: 'Limits',
    type: 'number',
    placeholder: '5',
  },
  {
    key: 'maxSubdomains',
    label: 'Max Subdomains',
    description: 'Maximum number of subdomains for this organization. Leave blank for the system default.',
    group: 'Limits',
    type: 'number',
    placeholder: '10',
  },
  {
    key: 'preferredDnsChallenge',
    label: 'Preferred DNS Challenge',
    description: 'Which DNS record type new domains use to prove ownership. TXT works everywhere; CNAME is handy in restricted environments.',
    group: 'Verification',
    type: 'select',
    defaultValue: 'TXT',
    options: [
      { value: 'TXT', label: 'TXT record' },
      { value: 'CNAME', label: 'CNAME record' },
    ],
  },
  {
    // Phase 56 (D346): the root tenant decides. `platform`: every new organization gets the default base domain and sees no choice;
    // `tenant`: the sign-up offers the base domains marked selectable, and an organization's owner may move to another one later.
    key: 'baseDomainChoice',
    label: 'Organizations choose their base domain',
    description: 'Whether a new organization may pick the base domain of its address (for example acme.hermetry.com instead of acme.roltek.xyz) from the base domains marked selectable, and its owner may change it later.',
    group: 'Base domains',
    type: 'select',
    defaultValue: 'platform',
    rootOnly: true,
    options: [
      { value: 'platform', label: 'No: the platform assigns the default base domain' },
      { value: 'tenant', label: 'Yes: organizations choose from the selectable base domains' },
    ],
  },
  {
    key: 'sslExpiryWarningDays',
    label: 'SSL Expiry Warning (days)',
    description: 'How many days before a certificate expires a domain is flagged "at risk" in the SSL expiry report.',
    group: 'SSL',
    type: 'number',
    placeholder: '30',
  },
];

// Default used by the report service when the tenant has not overridden it.
export const DEFAULT_SSL_EXPIRY_WARNING_DAYS = 30;
