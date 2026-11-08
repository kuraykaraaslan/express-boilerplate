// Non-sovereign Turkic/Turkic-people regions & communities that are absent from
// ISO 3166 / countries-list, added on explicit request with their languages and
// de-facto currencies. They have no flag artwork yet — see ../server/flag-art.source
// (`flag` is the region code); Xinjiang overrides to the PRC flag ('CN').
//
// `type: 'region'` distinguishes these from sovereign countries. Language codes
// prefer ISO 639-1 where it exists, else ISO 639-3 (Turkic minority languages —
// sah/tyv/alt/kjh/krc/kaa/gag/crh/kmz/qxq — are registered in
// ./languages so they resolve to a display name).
//
// NOTE: for stateless peoples (Crimean Tatars, Meskhetian Turks, East Turkestan)
// a "currency" is the de-facto money circulating in their present homeland — a
// pragmatic convenience, not a political statement.
import type { CountryInfo } from './types';
import type { CatalogueLanguageCode } from './localization.source';

type RegionSeed = {
  code: string;
  label: string;
  native: string;
  flag?: string; // defaults to `code`; Xinjiang overrides to 'CN'
  /**
   * Constrained to the codes the data source can NAME. A region that spoke a
   * language the catalogue cannot name would render as a bare subtag in the
   * picker; this used to be a throw in a build script, and is now a compile
   * error in the editor.
   *
   * Type-only import, fully erased — this file stays runtime-pure and no cycle
   * is created (`countries.ts` → `regions.ts` → *(type only)* → the seam).
   */
  languages: CatalogueLanguageCode[];
  currencies: string[];
};

const SEED: RegionSeed[] = [
  { code: 'TATARSTAN', label: 'Tatarstan', native: 'Татарстан', languages: ['tt', 'ru'], currencies: ['RUB'] },
  { code: 'BASHKORTOSTAN', label: 'Bashkortostan', native: 'Башҡортостан', languages: ['ba', 'ru'], currencies: ['RUB'] },
  { code: 'CHUVASHIA', label: 'Chuvashia', native: 'Чӑваш Ен', languages: ['cv', 'ru'], currencies: ['RUB'] },
  { code: 'SAKHA', label: 'Sakha (Yakutia)', native: 'Саха Сирэ', languages: ['sah', 'ru'], currencies: ['RUB'] },
  { code: 'TUVA', label: 'Tuva', native: 'Тыва', languages: ['tyv', 'ru'], currencies: ['RUB'] },
  { code: 'ALTAI', label: 'Altai Republic', native: 'Алтай Республика', languages: ['alt', 'ru'], currencies: ['RUB'] },
  { code: 'KHAKASSIA', label: 'Khakassia', native: 'Хакасия', languages: ['kjh', 'ru'], currencies: ['RUB'] },
  { code: 'KARACHAY_CHERKESSIA', label: 'Karachay-Cherkessia', native: 'Къарачай-Черкес Республика', languages: ['krc', 'ru'], currencies: ['RUB'] },
  { code: 'KABARDINO_BALKARIA', label: 'Kabardino-Balkaria', native: 'Къэбэрдей-Балъкъэр Республикэ', languages: ['krc', 'ru'], currencies: ['RUB'] },
  { code: 'KARAKALPAKSTAN', label: 'Karakalpakstan', native: 'Қарақалпақстан', languages: ['kaa', 'uz'], currencies: ['UZS'] },
  { code: 'GAGAUZIA', label: 'Gagauzia', native: 'Gagauziya', languages: ['gag', 'ro', 'ru'], currencies: ['MDL'] },
  { code: 'CRIMEA', label: 'Crimea', native: 'Qırım / Крым', languages: ['crh', 'ru', 'uk'], currencies: ['RUB'] },
  { code: 'CRIMEAN_TATARS', label: 'Crimean Tatars', native: 'Qırımtatarlar', languages: ['crh'], currencies: ['RUB'] },
  { code: 'XINJIANG', label: 'Xinjiang Uyghur Autonomous Region', native: 'شىنجاڭ ئۇيغۇر ئاپتونوم رايونى', flag: 'CN', languages: ['ug', 'zh'], currencies: ['CNY'] },
  { code: 'EAST_TURKESTAN', label: 'East Turkestan', native: 'Sherqiy Türkistan', languages: ['ug'], currencies: ['CNY'] },
  { code: 'SOUTH_AZERBAIJAN', label: 'South Azerbaijan', native: 'Güney Azərbaycan', languages: ['azb', 'fa'], currencies: ['IRR'] },
  { code: 'IRAQI_TURKMEN', label: 'Iraqi Turkmen (Turkmeneli)', native: 'Irak Türkmenleri', languages: ['tr', 'ar'], currencies: ['IQD'] },
  { code: 'SYRIAN_TURKMEN', label: 'Syrian Turkmen (Bayırbucak)', native: 'Suriye Türkmenleri', languages: ['tr', 'ar'], currencies: ['SYP'] },
  { code: 'SYRIAN_TURKMEN_ASSEMBLY', label: 'Syrian Turkmen Assembly', native: 'Suriye Türkmen Meclisi', languages: ['tr', 'ar'], currencies: ['SYP'] },
  { code: 'MESKHETIAN_TURKS', label: 'Meskhetian Turks (Ahıska)', native: 'Ahıska Türkleri', languages: ['tr'], currencies: ['TRY'] },
  { code: 'WESTERN_THRACE', label: 'Western Thrace Turks', native: 'Batı Trakya Türkleri', languages: ['tr', 'el'], currencies: ['EUR'] },
  { code: 'TURKMEN_SAHRA', label: 'Turkmen Sahra', native: 'Türkmensahra', languages: ['tk', 'fa'], currencies: ['IRR'] },
  { code: 'KHORASANI_TURKS', label: 'Khorasani Turks', native: 'Horasan Türkleri', languages: ['kmz', 'fa'], currencies: ['IRR'] },
  { code: 'SOUTH_TURKESTAN', label: 'South Turkestan (Afghan Turks)', native: 'Güney Türkistan', languages: ['uz', 'tk'], currencies: ['AFN'] },
  { code: 'QASHQAI', label: 'Qashqai', native: 'Qaşqaylar', languages: ['qxq', 'fa'], currencies: ['IRR'] },
];

export const REGIONS: CountryInfo[] = SEED.map((r) => ({
  code: r.code,
  alpha2: r.code, // keep unique (flag drives the icon, not alpha2)
  label: r.label,
  native: r.native,
  flag: r.flag ?? r.code,
  languages: r.languages,
  currencies: r.currencies,
  type: 'region' as const,
}));
