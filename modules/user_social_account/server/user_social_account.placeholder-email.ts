/**
 * Placeholder e-mail addresses of federated accounts.
 *
 * A login through a provider that returns no e-mail (national identity, Twitter, WeChat, ...) creates a user whose address is
 * synthetic: `<provider>-<sub>@noreply.invalid`. This module owns that convention because the identity store has to recognise
 * such users (the merge flow may only absorb a placeholder), and `auth_sso` mints them with `synthesizeSSOEmail`.
 */
export const SSO_PLACEHOLDER_DOMAIN = 'noreply.invalid'

export function synthesizePlaceholderEmail(provider: string, sub: string): string {
  const safeSub = String(sub).toLowerCase().replace(/[^a-z0-9._-]/g, '')
  return `${provider}-${safeSub}@${SSO_PLACEHOLDER_DOMAIN}`
}

export function isPlaceholderEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return email.toLowerCase().endsWith(`@${SSO_PLACEHOLDER_DOMAIN}`)
}
