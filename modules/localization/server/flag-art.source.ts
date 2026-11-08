/**
 * Flag ARTWORK seam — the counterpart of `./localization.source` for the inline
 * SVG behind `FlagIcon`.
 *
 * It is a SEPARATE file over a SEPARATE generated artefact for the same reason
 * as before: artwork is an order of magnitude larger than the code/name rows
 * (~46 KB gzip against ~18 KB) and only `FlagIcon` needs it. Asking for a
 * language label must not cost every flag.
 *
 * The markup comes from `country-flag-icons` (the TRNC from
 * `../data/localization.overlay.ts`), inlined by
 * `modules/localization/scripts/gen-localization-data.mts`, which sanitises it and HARD-FAILS on
 * anything that must not reach `dangerouslySetInnerHTML`. `./flag-art.test.ts`
 * asserts the same thing once more over the committed bytes, so the guarantee
 * does not rest on the generator having been run.
 *
 * ── Regions have no artwork right now ───────────────────────────────────────
 * The 25 non-sovereign entries in `./regions` render without a flag icon,
 * except XINJIANG which flies the PRC flag (`flag: 'CN'`) and resolves through
 * the map below like any country. Their artwork remains unshipped over
 * unresolved Wikimedia licences (and five of the candidate SVGs carry
 * `<use xlink:href>`, which the safety assertion rejects).
 *
 * When licensed artwork lands this file grows a second accessor and one
 * generated file. Until then a region simply has no icon, which is the honest
 * state; do not substitute a sovereign flag for one (showing the Russian flag
 * for Tatarstan would say the opposite of what the entry exists to say).
 */
import { COUNTRY_FLAGS } from '../data/country-flags.generated';

/** Code → inline SVG markup or a `data:` URI. */
export type FlagArtMap = Record<string, string>;

export type FlagArtSource = {
  /** Keyed by ISO 3166-1 alpha-2 (`TR`, `CT`, `GB`), plus `EU` and `IC`. */
  countryFlags(): FlagArtMap;
};

export const flagArtSource: FlagArtSource = {
  countryFlags: () => COUNTRY_FLAGS,
};

export const countryFlagArt = (): FlagArtMap => flagArtSource.countryFlags();
