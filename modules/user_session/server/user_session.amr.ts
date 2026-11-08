/**
 * The authentication methods behind a session (`amr`, RFC 8176), recorded in `user_sessions.metadata.amr` by the login paths and read by whoever
 * must say how a person signed in: Fleet ID puts them in the ID token (12 section 5: `pwd`, `mfa`, `hwk`, `fed:google`, `fed:org:<id>`), so a
 * node's policy can demand a stronger method (`subject.amr`). Pure.
 *
 * A session records only what its login path proved: `pwd` for a password, `hwk` for a passkey, `fed:<provider>` for a social login; a second
 * factor verified later adds `otp` and `mfa`. Anything outside the vocabulary below is dropped rather than stored, so a provider name that is
 * not a plain token can never become a claim.
 */
export const AMR_RE = /^(?:pwd|otp|sms|mfa|hwk|swk|pin|user|fed:[a-z0-9][a-z0-9_-]{0,31}|fed:org:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/
export const AMR_MAX = 8

/** The valid, de-duplicated values of `values`, in their first order, at most {@link AMR_MAX}. */
export function normalizeAmr(values: readonly unknown[] | null | undefined): string[] {
  const out: string[] = []
  for (const v of values ?? []) {
    if (typeof v !== 'string' || !AMR_RE.test(v) || out.includes(v)) continue
    out.push(v)
    if (out.length === AMR_MAX) break
  }
  return out
}

/** The `amr` for a social login through `provider`: `fed:<provider>` when the name is a plain token, nothing otherwise. */
export function federatedAmr(provider: string): string[] {
  return normalizeAmr([`fed:${provider.toLowerCase()}`])
}

/**
 * Did this session prove a second factor (or a phishing-resistant authenticator)? `mfa` is added when an OTP / TOTP is verified on the session;
 * `hwk` is a passkey login (possession plus user verification). Enrolment alone never counts: only what the session itself recorded (F.auth.05, S2).
 */
export function amrHasSecondFactor(amr: readonly unknown[] | null | undefined): boolean {
  const values = normalizeAmr(amr)
  return values.includes('mfa') || values.includes('hwk')
}
