# i18n

The application-UI **translation runtime**. It answers one question — *what does
this key say in the active language?* — and nothing else.

It carries **no reference data**. Language/country/currency catalogues, flags and
their pickers live in [`modules/localization`](../localization) (the *data*
module). The split is deliberate and one-directional:

```
localization  ──imports──▶  i18n        (pickers translate their own labels)
i18n          ──imports──▶  ∅            (zero module dependencies)
```

`i18n` is a genuine leaf: ~600 files import it, so anything it pulled in would be
pulled into every bundle in the app.

## Surfaces

| Path | What it is |
|---|---|
| `server/i18n.core.ts` | Pure primitives: `Messages` / `Locale` / `Direction` / `TFunction` types + `interpolate()` for `{{var}}` placeholders. |
| `server/i18n.locale.ts` | `resolveAppLocale()` and `APP_LOCALE_COOKIE`, the single dependency-free source the `ui/` leaves below re-export, so a server route can answer in the caller's UI language (cookie → tenant default → `en`, clamped to the enabled set) without importing `ui/`. |
| `server/messages.ts` | `getMessages()` / `createServerT()` — resolve a message in the **recipient's** locale (emails, notifications, API errors) from a module's own `dictionaries`. `loadServerT()` does the same with the stored texts of `setMessageOverlay()` laid over them. Framework-free. |
| `ui/index.ts` | The client barrel: `I18nProvider`, `useT`, `useLocale`, `useDir`, `useI18n`, `useAppLanguages`, `resolveAppLocale`, `interpolate`, the `app_locale` cookie helpers. |
| `ui/i18n.context.component.tsx` | `<I18nProvider>` + hooks. Seeded server-side by the RSC admin layout, which passes the active-locale bundle in as a prop. |
| `ui/resolve-ui-locale.ts` | `resolveAppLocale()` — user preference → tenant default → `en`, clamped to the enabled set. Re-exports `server/i18n.locale.ts`, so RSC, client and server routes all call the same function. |
| `ui/app-locale.ts` | The `app_locale` cookie (name + read/write), the fast SSR mirror of `user_preferences.language`. |

## Using it

In a `'use client'` component:

```ts
import { useT } from '@kuraykaraaslan-labs/i18n/ui';

const t = useT();
t('coupon.list.title', 'Coupons');
t('coupon.msg.deleted', 'Deleted {{name}}', { name });
```

On the server (recipient's locale, not the request UI's):

```ts
import { createServerT } from '@kuraykaraaslan-labs/i18n/server/messages';
import { dictionaries } from '@kuraykaraaslan-labs/coupon/dictionaries';

const t = createServerT(dictionaries);
t('coupon.mail.subject', user.language, 'Your coupon expires soon');
```

`createServerT` is static: it reads the dictionaries in code only. To also read the texts kept
in the database (a corrected text, a language the code does not ship), use the async
`loadServerT`, bound to one locale. Read order: stored text → dictionary of the locale →
English → fallback → key.

```ts
import { loadServerT } from '@kuraykaraaslan-labs/i18n/server/messages';

const t = await loadServerT(dictionaries, user.language);
t('coupon.mail.subject', 'Your coupon expires soon', { name });
```

The stored texts arrive through `setMessageOverlay(fn)`: `i18n` only holds the function (on
`globalThis`, since Next evaluates the module separately in instrumentation and in the route
handlers) and stays dependency-free. `translation` installs it at boot (`common:boot_task`,
phase `runtime`) and reads the `web` texts through its Redis cache. With no overlay installed,
or one that throws, `loadServerT` resolves exactly like `createServerT`.

Dictionaries themselves stay with their own module
(`modules/<id>/dictionaries/{en,tr,…}.json`) — this module never owns another
module's strings. Full step-by-step:
[HOW_TO_LOCALIZE_A_MODULE.md](HOW_TO_LOCALIZE_A_MODULE.md).

## What is NOT here

The **application-language switcher** (`AppLanguageSwitcher`) lives in
`localization`, not here: it renders flags and native language names, i.e. it is
a language *picker* over the catalogue. It writes this module's `app_locale`
cookie — the allowed direction.

`isRtlLang`, `localeLabel`, `flagCountry`, `narrowLanguages` are catalogue
questions and live in `@kuraykaraaslan-labs/localization/server/languages`.
