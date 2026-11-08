/**
 * What the connected-accounts panel needs to know about a national identity provider stored as `acs:<provider>`: its protocol,
 * country and button label. The facts live here so the identity store can describe the accounts it holds without depending on
 * `auth_national_id`; that module builds its provider catalog on top of this table (and adds the secrets-free defaults).
 */
export interface AcsProviderFacts {
  protocol: 'saml' | 'oidc'
  /** ISO country, or 'EU' for the eIDAS node. */
  country: string
  /** Human label for the login button. */
  label: string
}

export const ACS_PROVIDER_FACTS = {
  tr_edevlet: { protocol: 'saml', country: 'TR', label: 'e-Devlet ile Giriş' },
  ct_edevlet: { protocol: 'saml', country: 'CT', label: 'e-Devlet (KKTC) ile Giriş' },
  az_mygovid: { protocol: 'oidc', country: 'AZ', label: 'MyGov ID' },
  uz_oneid: { protocol: 'oidc', country: 'UZ', label: 'OneID' },
  kz_egov: { protocol: 'oidc', country: 'KZ', label: 'eGov.kz' },
  kg_tunduk: { protocol: 'oidc', country: 'KG', label: 'Tunduk' },
  esia_ru: { protocol: 'oidc', country: 'RU', label: 'Госуслуги' },
  eu_eidas: { protocol: 'saml', country: 'EU', label: 'eIDAS' },
  it_spid: { protocol: 'saml', country: 'IT', label: 'Entra con SPID' },
  es_clave: { protocol: 'saml', country: 'ES', label: 'Cl@ve' },
  de_eid: { protocol: 'saml', country: 'DE', label: 'Online-Ausweis (eID)' },
  us_login_gov: { protocol: 'oidc', country: 'US', label: 'Login.gov' },
  us_id_me: { protocol: 'oidc', country: 'US', label: 'ID.me' },
} as const satisfies Record<string, AcsProviderFacts>
