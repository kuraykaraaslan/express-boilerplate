# localization

Locale reference **data** — and the pickers that render it. What a language,
country, currency, timezone or date format *is*, and how it relates to the
others.

The translation **runtime** (`useT`, `<I18nProvider>`, `app_locale`,
`createServerT`) is a separate module: [`modules/i18n`](../i18n). The dependency
runs one way only:

```
localization  ──imports──▶  i18n        (pickers translate their own labels)
i18n          ──imports──▶  ∅
```

Self-contained at runtime: no `iso-639-1`, `countries-list`, `country-flag-icons`
or `Intl` lookups reach any bundle. The reference data is a **committed
projection** under [`data/`](data/), read through one seam.

## Where the data comes from

[`modules/localization/scripts/gen-localization-data.mts`](../../scripts/gen-localization-data.mts)
(`npm run gen:localization-data`) projects four public npm packages — all
devDependencies except `libphonenumber-js`, which is already a prod dep — into
five generated files:

| Generated file | Source | Rows |
|---|---|---|
| `data/languages.generated.ts` | `iso-639-1` + overlay | 194 (183 ISO 639-1 + 11 Turkic 639-3) |
| `data/countries.generated.ts` | `countries-list` + overlay | 253 (incl. the TRNC as `CT`/`CTR`) |
| `data/currencies.generated.ts` | `countries-list/currencies` | ~156 (country-referenced ∪ keep − fund codes) |
| `data/dialing.generated.ts` | `libphonenumber-js` metadata + overlay | 250 E.164 plans |
| `data/country-flags.generated.ts` | `country-flag-icons` + overlay | 255 inline SVGs (countries + `EU`/`IC`) |

[`data/localization.overlay.ts`](data/localization.overlay.ts) is the one
hand-maintained input: the reference rows no public package carries — the TRNC
as a country with its dialing plan and flag, the eleven Turkic ISO 639-3
languages `server/regions.ts` speaks, the Cyprus naming and the Türkiye guard,
and RTL flags for the 639-1 set (`iso-639-1` has no direction data). The
generator merges it, so the product's political modelling survives any upstream
refresh.

The projection is **committed**, so `npm ci && npm run build` needs nothing
beyond the repo — no private registry, no token. Refreshing the data is a
deliberate, reviewed `npm run gen:localization-data`, never part of install:
upstream releases move reference data, and that movement should arrive as a
readable diff, not as a surprise in CI.

Why a build step and not runtime imports: the catalogues here are consts
consumed inside `'use client'` components, and the source packages are the wrong
size for that — libphonenumber's metadata alone is ~85 KB gzip, the flag barrel
~190 KB raw. The generator reads them in Node and emits picker-sized rows
(~8 KB of languages). The five files are separate on purpose: a bundle asking
for a language label must not carry every flag.

## The seam

**Nothing in this module names the generated files except the two seam files.**
They are the swap point if the origin moves again:

| Seam | Feeds | Payload |
|---|---|---|
| [`server/localization.source.ts`](server/localization.source.ts) | `languages` · `countries` · `currencies` · `dialing` | code/name rows, ~18 KB gzip |
| [`server/flag-art.source.ts`](server/flag-art.source.ts) | `FlagIcon` | inline SVG, 46 KB gzip |

They are split on purpose: asking for a language label must not pull every flag
into the bundle. The row shapes are declared in the seam rather than imported
from the generated files, so a generator that changes shape breaks there with a
readable error instead of silently reshaping 250-odd rows.

Row accessors are **synchronous** and read at module-evaluation time, because the
catalogues they build (`LANGUAGES`, `COUNTRIES`, `CURRENCIES`) are consts used
inside client components. Any origin therefore has to be materialised **before
import**. Making them genuinely async means turning the three catalogue modules
lazy first; that is a separate change.

Curated **policy** stays with the catalogue that applies it — the `CYP` label
override, the non-sovereign Turkic regions, the language→flag map, the
presentation order. Swapping the origin must not silently drop one; that
divergence is exactly what DUP-05 closed. Script **direction** is
not policy either — it rides in the row's 4th slot (recorded in the overlay,
because `iso-639-1` carries no direction data).

## Flags

255 inline SVGs (46 KB gzip) in `data/country-flags.generated.ts`, from
`country-flag-icons` (the TRNC's from the overlay) — every country plus `EU` and
`IC`. Inline rather than `<img>` because a 250-row dropdown
must not fire 250 requests, the markup has to survive SSR, and CSS has to be able
to style it. `CurrencySelector` (22 importers) and `PhoneInput` (15) both render
`FlagIcon`, so this is in essentially every admin bundle — deliberately.

**The non-sovereign regions have no artwork.** The 24 hand-inlined SVGs that used
to cover them are gone: their Wikimedia licences are unresolved, and five of them
carry `<use xlink:href>` which the safety assertion rejects. Until licensed
artwork lands (as a second overlay entry + generated file):

- a region row renders with no icon (`XINJIANG` is the exception — it flies the
  PRC flag by design, so it resolves through the country map);
- the eleven Turkic ISO 639-3 languages take the neutral `INT` globe instead of
  their region's flag.

Substituting a sovereign flag is not the fallback: the Russian flag on Sakha says
the opposite of what the entry exists to say. `server/flag-art.test.ts` asserts
that exactly one region resolves today, so the moment region artwork lands that
test fails and points at the two places to wire it back into.

## Safety of inlined artwork

`FlagIcon` injects this markup with `dangerouslySetInnerHTML`, and it originates
in a third-party package. Two layers guard it, both in this repo:

1. the generator sanitises at inline time and **hard-fails** on anything that
   must not reach `dangerouslySetInnerHTML` (script / foreignObject / use /
   xlink:href / on* handler / javascript:);
2. [`server/flag-art.test.ts`](server/flag-art.test.ts) re-asserts the
   **committed bytes** with a deliberately duplicated regex — the layer that
   matters, because it holds whether or not the generator was run.

### Still hand-maintained

Two files: the 25-entry region seed in [`server/regions.ts`](server/regions.ts)
(curated policy) and [`data/localization.overlay.ts`](data/localization.overlay.ts)
(reference rows no public package carries). Everything else under `data/` is
generated.

The seed's `languages` are typed `CatalogueLanguageCode`, so a region that speaks
a language the data source cannot name is a **compile** error; the generator
asserts the same invariant against the overlay at generation time.

## Catalogues (`server/`)

| File | Exports |
|---|---|
| `languages.ts` | `LANGUAGES`, `LANGUAGE_OPTIONS`, `getLanguage`, `localeLabel`, `flagCountry`, `isRtlLang`, `baseLang`, `isValidLangCode`, `narrowLanguages`, `parseEnabledLanguages` |
| `countries.ts` | `COUNTRIES`, `SOVEREIGN_COUNTRIES`, `REGIONS_ALL`, the `*_OPTIONS` / `SOVEREIGN_ALPHA2_*` picker + enum sets, `getCountry`, `countriesForLanguage`, `currenciesForCountry`; **dialing**: `DIAL_OPTIONS`, `DIALING_COUNTRIES`, `getDialing`, `primaryCountryForCallingCode` |
| `currencies.ts` | `CURRENCIES`, `CURRENCY_OPTIONS`, `getCurrency` |
| `regions.ts` | `REGIONS` — non-sovereign Turkic regions & peoples (curated policy) |
| `timezones.ts` | `TIMEZONE_OPTIONS`, `DEFAULT_TIMEZONE` (zone list reused from `common`, so options always match what the DTOs accept) |
| `datetime.ts` | `DATE_FORMAT_OPTIONS`, `TIME_FORMAT_OPTIONS`, `FIRST_DAY_OPTIONS` |
| `narrow.ts` | `narrowOptions` — the one allow-list rule every picker shares: no allow-list → show everything |
| `types.ts` | `LanguageInfo`, `CountryInfo` (carries `dial`), `DialingInfo`, `CurrencyInfo`, `FlagOption` |

`SOVEREIGN_ALPHA2_CODES` / `LANGUAGES` are also the build-time source for
`modules/common`'s Zod enums — regenerate with `npm run gen:localization-codes`
after changing the data. `common` cannot import this module at runtime (the UI
here imports `common`, so the edge would cycle).

## Pickers (`ui/`)

`FlagIcon` · `FlagSelect` / `FlagMultiSelect` (generic) · `LanguageSelect` ·
`CountrySelect` · `CurrencySelect` · `CurrencySelector` · `TimezoneSelect` ·
`DateFormatSelect` / `TimeFormatSelect` / `FirstDaySelect` ·
`AppLanguageSwitcher`.

Every domain picker ships the FULL catalogue and takes an optional domain-named
allow-list (`languages`, `countries`, `currencies`, `timezones`, `formats`,
`days`) to offer a subset, in the allow-list's order.

`AppLanguageSwitcher` lives here rather than in `i18n` because it is a language
picker over the catalogue — it writes `i18n`'s `app_locale` cookie, which is the
allowed direction.

## `PhoneInput` — the platform's only phone field

`ui/phone-input.component` is a dial-code country picker plus a number box that
emits **one international number**:

```tsx
<PhoneInput id="ct-phone" label="Phone" value={form.phone}
  onChange={(phone) => setForm((f) => ({ ...f, phone }))} />
```

`value` and `onChange` speak `+…` and nothing else, so a page never normalizes
anything: a person types `0532 123 45 67` and the form state holds
`+905321234567`. Plain `<Input type="tel">` fields are what let national-format
strings into columns the platform promises are E.164 — use this instead.

The country it starts on comes from `ui/tenant-country.context`
(`<TenantCountryProvider country={…}>`), which the admin layout fills once from
the tenant's `defaultCountry` setting — **the platform's single country
setting**, shared by phone parsing, national-id validation and holiday seeding
alike (see `tenant_setting.country.ts`). Pass `defaultCountry` only to override
it for a form that is always about one specific country.

To show a stored number in a list or a message, use `displayPhone(value)` from
`ui/phone-display` (`+905321234567` → `+90 532 123 45 67`, the same `min`
metadata as the field). Anything that is not an international number (an
extension, a SIP address, `anonymous`) comes back as stored.

**Two libphonenumber metadata sets, on purpose.** This component imports
`libphonenumber-js/min` (~85 KB) for as-you-type formatting and a length check;
the authoritative parse is `parsePhone` in
[`common/server/common.phone`](../common/server/common.phone.ts), which imports
`/max` (~158 KB) because only that set can tell `+9012` is not a real number.
The server is the authority — never import `common.phone` into a client bundle.
