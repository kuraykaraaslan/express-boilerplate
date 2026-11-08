// Reference i18n types. Pure — no runtime imports, safe on client + server.

export type LanguageInfo = {
  /** BCP-47 primary subtag (ISO 639-1), lowercased. */
  code: string;
  /** Native display name (falls back to the English name). */
  label: string;
  /** English display name. */
  englishName: string;
  /** Right-to-left script. */
  rtl?: boolean;
  /** ISO-3166 country code for a flag (optional — languages ≠ countries). */
  flag?: string;
};

/**
 * A territory's E.164 dialing plan — everything a phone input needs to turn what
 * a person types into a canonical number, minus the validation itself.
 *
 * This is reference DATA, not a parser. Authoritative validation is
 * `parsePhone` in `@kuraykaraaslan-labs/common/server/common.phone`; these fields
 * exist so a picker can offer `+90` beside a Turkish flag and tell the user
 * their number is the wrong length before the round trip.
 */
export type DialingInfo = {
  /** E.164 country calling code, without the `+` — e.g. `"90"`. */
  callingCode: string;
  /**
   * Set on the ONE territory that owns a shared calling code — `US` for `+1`,
   * `GB` for `+44`, `TR` for `+90`. Absent where the code is unshared, so
   * `primary` is not a synonym for "sovereign".
   */
  primary?: true;
  /**
   * National-number prefix separating this territory from the others on its
   * calling code — `"392"` for the TRNC on `+90`, `"268"` for Antigua on `+1`.
   *
   * A regular-expression SOURCE string, not a literal list: apply it as
   * `new RegExp('^(?:' + leadingDigits + ')')` to the national significant
   * number. Absent does NOT mean unambiguous — `+1` US/CA and `+44` GB/GG/JE
   * have no discriminator upstream at all.
   */
  leadingDigits?: string;
  /** Domestic long-distance prefix, e.g. `"0"`. Absent where the plan has none. */
  nationalPrefix?: string;
  /** Valid national significant number lengths, ascending — e.g. `[10]`. */
  nsnLengths: number[];
  /** A well-formed national significant number, for placeholders. */
  exampleNumber?: string;
};

export type CountryInfo = {
  /** ISO-3166 alpha-3 code (e.g. "TUR"), or a custom code such as "TATARSTAN". */
  code: string;
  /** ISO-3166 alpha-2 code (e.g. "TR") — kept because country-flag-icons keys
   *  and the `flag` field are alpha-2. */
  alpha2: string;
  /** English name. */
  label: string;
  /** Native name. */
  native: string;
  /** ISO-3166 alpha-2 for the flag icon (region flags handled by FlagIcon). */
  flag: string;
  /** ISO 639-1/639-3 language codes spoken there. */
  languages: string[];
  /** ISO 4217 currency codes used there. */
  currencies: string[];
  /** Entry kind — omitted for sovereign ISO countries; `'region'` for
   *  non-sovereign / de-facto / stateless-people entries (e.g. Tatarstan, Gagauzia). */
  type?: 'country' | 'region';
  /** E.164 dialing plan. Absent for the curated regions and the few ISO
   *  territories with no plan of their own (see `DIALING_UNCOVERED` upstream). */
  dial?: DialingInfo;
};

export type CurrencyInfo = {
  /** ISO 4217 code. */
  code: string;
  /** Display name (e.g. "US Dollar"). */
  label: string;
  /** Symbol (may fall back to the code for some currencies). */
  symbol: string;
  /** Representative country code for a flag (optional). */
  flag?: string;
};

/** Option shape consumed by the common FlagSelect / FlagMultiSelect. */
export type FlagOption = { value: string; label: string; flag?: string };
