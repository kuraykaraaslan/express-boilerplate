# translation

UI texts kept in the database, on top of the module dictionaries in code. A language the code does not ship, or a
corrected text, goes live without a deploy (web) or a store release (mobile).

The English source stays in code: `modules/<id>/dictionaries/*.json`, generated from the `t('key', 'English')`
fallbacks (see `modules/i18n/HOW_TO_LOCALIZE_A_MODULE.md`). This module is a layer over those files, and the read order
is **database > JSON > English**, per key.

Three modules, one job each:

| Module | Job |
|---|---|
| `i18n` | the runtime: `useT`, `createServerT`, locale resolution. Zero dependencies. |
| `localization` | reference data: ISO languages, countries, flags, and the pickers. |
| `translation` | stored texts: the `translations` table, their versions and their cache. |

## Status

| Step | What | State |
|---|---|---|
| 1 | Entity, migration, RLS classification | done |
| 2 | Versions, the Redis cache, the read and write services | done |
| 3 | The two guest routes the mobile app reads | done |
| 4 | The overlay in `resolveAdminI18n` and the async `loadServerT` | done |
| 5 | System-level admin API (GLOBAL) and the `translation:import` CLI | done |
| 6 | The root-tenant admin screen over that API | done |

Later: Bulgarian (`bg`) and the other large languages' content (loaded with step 5), notifications translated into
the recipient's `user_preferences.language`.

## Adding a language

1. Load its texts once, system-wide: `npm run translation:import -- bg ./bg.json` (a preview), then the same with
   `--write`; or `POST /api/translations/import`. The file is flat, `{ "auth.login.title": "…" }`, the shape of
   `dictionaries/en.json` and of the export.
2. Each tenant turns it on in its own settings (Localization → Available languages). Nothing is enabled for the
   tenants automatically: a tenant chooses which of the platform's languages it offers.

### Seed files

[`data/seed/`](data/seed) holds a language's first load, so every environment (dev, staging, production) starts
from the same texts:

| File | What |
|---|---|
| [`bg.json`](data/seed/bg.json) | Bulgarian: 20 380 keys, every web dictionary and the mobile snapshot, machine-translated (2026-10-20) for the customer to review |
| [`bg.glossary.md`](data/seed/bg.glossary.md) | the rules and the term choices the translation follows; read it before reviewing |

```
npm run translation:import -- bg modules/translation/data/seed/bg.json            # preview
npm run translation:import -- bg modules/translation/data/seed/bg.json --write    # store
```

A seed is a starting point, not the source of truth: corrections are made in the admin screen and live in the
database. The file is not kept in sync with them, nor with keys added to the code later. Importing it again
overwrites a corrected text with the seed's, so do it only on an environment that has none yet (the preview
says how many would change).

## Admin screen

`/admin/translations` in the system workspace (menu *Platform → Translations*, permission `translation.texts.read`),
root tenant only: a 404 on any other tenant, and every call goes to the GLOBAL API below
([page](ui/translations.page.tsx)).

- Pick a language; the modules list shows, per module, the source keys (web and mobile, see
  [The mobile English source](#the-mobile-english-source)), the keys the code ships for it and the stored rows per
  platform. Modules with neither keys nor rows are hidden until asked. Under the list: which mobile commit the
  snapshot was taken from, and when, so a stale one is noticed.
- Open a module: every key with the English source, the dictionary in code and the stored texts for web and mobile,
  web only and mobile only; search, *only missing*, keys only the mobile app has marked *Mobile only*, and orphans
  (stored, in neither English source) flagged. Missing: no text in the code and none stored for the key's readers, a
  shared text for a web key (or one both apps have), a shared or a mobile one for a mobile-only key.
- Edit a key in a dialog: only what changed is sent; an emptied field deletes that text, so the dictionary in code
  shows through again.
- *Add key*: store a text under a key the list does not show, after the fixed `<module>.` prefix; for a key the code
  reads but builds at run time. The key must follow the server's rule and not be listed already (that one is edited
  from its row); at least one platform needs a text. A key nothing reads is shown nowhere, which the dialog says.
  Menu labels need no adding: the extractor puts `<module>.menu.<id>` in every `en.json`.
- *JSON* tab: every key of the module on one platform as one flat object, edited at once (a whole translation pasted
  from a translator or a tool). A value is the stored text, `""` where none is stored; the dictionary in code is never
  copied in, so saving cannot shadow it. An emptied or removed key deletes its stored text. Saving first shows how
  many texts are saved and deleted, names the deleted keys and the keys the code lacks, then sends only the
  difference (in slices of 1000). Broken JSON, nested values and keys outside the module are flagged at their line.
- Import: a JSON file and a platform, a preview of what is new / changed / unchanged / refused, then the write.
  Export: the stored texts of one platform as the same flat file.

The screen's own texts are translated like any module's (`dictionaries/en.json`, `tr.json`); the menu label is
`translation.menu.platform-translations`, which the page title reuses so the extractor keeps it.

## The mobile English source

The mobile app (the `expo-react-native-boilerplate` repo) has keys the web never
uses (biometric prompts, native permission texts…). So the admin screen lists them, its English source is kept here
as a snapshot, committed:

| File | What |
|---|---|
| [`data/mobile.en.json`](data/mobile.en.json) | flat key → English text, sorted: every `modules/*/dictionaries/en.json` of the mobile repo merged |
| [`data/mobile.en.meta.json`](data/mobile.en.meta.json) | `{ commit, date, keyCount }`: the mobile commit (`git rev-parse --short HEAD`), `-dirty` when its English dictionaries had uncommitted changes, `not-a-git-repo` outside git; when it was synced; how many keys |

Refresh it whenever the mobile app adds, renames or removes a key, and commit both files:

```
npm run translation:sync-mobile -- ../expo-react-native-boilerplate
```

([script](scripts/translation-sync-mobile.mts), [helpers](scripts/translation-sync-mobile.lib.ts)). Each key must be
a text, carry its own module folder as prefix, follow the server's key rule and belong to a module this repo has;
anything else is listed and nothing is written. Nothing is rewritten when the keys, the texts and the commit are what
the snapshot holds. Only the English source is copied: the mobile app's bundled `tr`/`de`… are not, so for a new
language every mobile key shows as missing until a text is stored.

The admin service ([mobile-source](server/translation.mobile-source.ts)) merges it with the web dictionaries: a
key's English is the web's, else the mobile's; `source` is `web`, `mobile`, `both` or `null`, and `orphan` means
`null`, in neither. A mobile module this build does not register is left out of the summary. The guest routes the
apps read are not affected: the snapshot only feeds the admin screen.

## Texts created at run time: `translation:source`

Some texts have no `t('key', 'English')` in code: the sidebar's renamed items, added workspaces and groups and custom
links that the sysadmin sets in Platform → Menu ([shell_menu](../shell_menu/README.md), docs/phases/54-menu-editor). A
module with such texts contributes them to the server extension point `translation:source`
([contract](server/translation.sources.types.ts), [host](server/translation.sources.ts)): `sources()` answers
`[{ module, key, en }]`, the module being the contributor's own and the key starting with it. The admin service merges
them into the English source beside the web dictionaries and the mobile snapshot, with `source: 'runtime'` (the screen
marks them "Set in the app"): they are listed, counted in the summary, found by *only missing*, exported and imported
like any key, and their stored texts are never flagged as leftovers. A contributor that fails is left out of that
answer; the screen still loads. `translation` imports nothing of a contributor.

A caller that must write texts in its own transaction (a menu publish writes the menu and its labels together) uses
`TranslationWriteService.upsertManyIn(manager, …)` / `removeManyIn(manager, …)` and runs the returned `afterCommit`
once its transaction has committed, so the cache is never refilled from rows that may still roll back.

## System-level admin API

Root super-admin only, behind the KD-13 admin gate (`GLOBAL` scope: root-tenant ADMIN, IP allowlist, MFA when
`adminRequireMfa` is on). The texts are system-wide, so the URL tenant is only where the dispatcher mounts the routes.
`platform` is spelled `shared` (NULL in the table), `web` or `mobile`. Every write is audited on the root tenant
(`translation.texts.saved` / `.removed` / `.imported`, with the caller, the counts, the modules), and a failing audit
never undoes a write.

| Route | Permission | What |
|---|---|---|
| `GET /api/translations?locale&module&q` | `translation.texts.read` | every key of one module: English source (web, else the mobile snapshot) and its `source`, the dictionary in code for the language, the stored texts per platform, orphans (stored, in neither source) |
| `GET /api/translations/summary?locale` | `translation.texts.read` | per module: source keys (web ∪ mobile), keys the code ships for the language, stored rows per platform; how far a language is |
| `PUT /api/translations` `{ entries }` | `translation.texts.manage` | save up to 1000 texts, one transaction |
| `DELETE /api/translations` `{ refs }` | `translation.texts.manage` | delete up to 1000 texts, one statement per 500 (`unnest`), one transaction |
| `POST /api/translations/import` `{ locale, platform?, messages, write? }` | `translation.texts.manage` | up to 20 000 keys; the module is each key's prefix; reports new / changed / unchanged / invalid (malformed key, unknown module, empty text); writes the new and changed ones only with `write: true` |
| `GET /api/translations/export?locale&platform` | `translation.texts.read` | the stored texts of one language and platform as a flat map the import takes back |

Writes refuse a language that does not exist in ISO 639 (a typo never creates one) and a module that is not
registered. [Service](server/translation.admin.service.ts), [DTOs](server/translation.admin.dto.ts).

**CLI.** [`scripts/translation-import.mts`](scripts/translation-import.mts) runs the same import:
`npm run translation:import -- <locale> <file.json> [--platform shared|web|mobile] [--write]`, a preview unless
`--write`, audited with `via: cli`. It needs the database migrated (`npm run db:deploy`): the upsert relies on the
unique index migration 001 creates. In development, `getDataSource()` also synchronizes the schema from the entities,
as `npm run dev` does.

## Data model

`translations`, one row per stored text ([entity](server/entities/translation.entity.ts),
[migration](server/migrations/001_translations.sql)):

| Column | Meaning |
|---|---|
| `translationId` | uuid primary key |
| `locale` | language code as the tenant enables it (`bg`, `pt-br`), lowercased |
| `module` | the module the key belongs to |
| `platform` | NULL = shared by web and mobile; `web` or `mobile` = that platform only |
| `key` | flat key, `<module>.<area>.<slug>`, e.g. `auth.login.title` |
| `value` | the text |
| `createdAt`, `updatedAt` | `updatedAt` feeds the version (below) |

Guarantees in the database, not only in the service:

- `uq_translations_scope_key`: one text per `(locale, module, platform, key)`, **`NULLS NOT DISTINCT`**, so two
  shared-platform rows for the same key collide. TypeORM 0.3 cannot express the option, so
  the migration creates the index and the entity declares it with `synchronize: false`.
- `ck_translations_key_module`: the key starts with `<module>.`.
- `ck_translations_platform`: `platform` is NULL, `web` or `mobile`. The routes' `android` and `ios` are mapped to
  `mobile` before they reach the table.

The migration is the DDL TypeORM generates from the entity (constraint names included), idempotent, so a
`synchronize` deployment and a `migrate` deployment build the same table. `npm run db:schema:drift` reports no drift
for it.

## Platforms and scopes

Clients name `android`, `ios` or `web` (react-native's `Platform.OS`); `android` and `ios` read the `mobile` rows
([translation.platform.ts](server/translation.platform.ts)). A platform reads its own rows plus the shared rows, and
its own row wins on the same key. A versions request that names no platform is computed over **every** row (scope
`all`): a client that cannot say which platform it is may download more than it needs, but never misses a change.

## Versions

A version is per `(locale, module, scope)`: `<latest updatedAt in microseconds>-<row count>` over the rows the scope
reads, e.g. `1760617854123456-42`; `0-0` for a module with no rows. Clients compare it for equality only. The mobile
app downloads only the modules whose version changed.

- An insert or an update moves the first part, a delete the second: a deleted row changes the version even when it
  was not the newest.
- Saving a text unchanged does not touch the row (`WHERE value IS DISTINCT FROM`), so the version stays and no client
  downloads the module again.
- `updatedAt` is `clock_timestamp()`, not `now()` (the transaction start), so a long transaction that commits after a
  short one does not stamp an older time.
- The versions map and a bundle compute the version with the same SQL expression, so a bundle always carries the
  version the map announced; otherwise the app would download the same module on every start. The real-database
  test checks this.

Known limit: two writers updating the same module, where the one with the older `clock_timestamp()` commits last,
leave max(updatedAt) and the count unchanged and the version does not move for that update. Rare with an admin
editor; the next change to the module moves it.

## Services

| | |
|---|---|
| [`TranslationReadService.getVersions(locale, scope)`](server/translation.read.service.ts) | module → version, only modules with at least one row |
| [`TranslationReadService.getBundle(locale, module, platform)`](server/translation.read.service.ts) | `{ version, messages }`, shared rows with the platform's rows over them |
| [`TranslationReadService.getVersionsMany(locales, scope)`](server/translation.read.service.ts) | `getVersions` for several locales in one MGET (misses read one by one) |
| [`TranslationReadService.getBundles(locale, modules, platform)`](server/translation.read.service.ts) | `getBundle` for several modules: one MGET, one database read for all the misses |
| [`TranslationWriteService.upsertMany(entries)` / `upsert`](server/translation.write.service.ts) | insert or replace, one transaction, 500 rows per statement; the same key twice: the last wins |
| [`TranslationWriteService.removeMany(refs)` / `remove`](server/translation.write.service.ts) | delete texts, one statement per 500 references, one transaction; the dictionary in code shows through again |

Input goes through [translation.dto.ts](server/translation.dto.ts) first: the locale and the module id become parts of
Redis keys, so they are restricted to characters that cannot forge a key segment. A rejected input throws a ZodError,
which `normalizeError` turns into a 400.

## Cache

Same method as `tenant_setting.cache`: every Redis failure is a miss (the read goes to the database) and a failed
write or delete is swallowed. TTL 600 s with ±10 % jitter.

| Key | Holds |
|---|---|
| `i18n:ver:<locale>:<scope>` | module → version, scope `web`, `mobile` or `all` |
| `i18n:msg:<locale>:<module>:<platform>` | `{ version, messages }`, platform `web` or `mobile` |

- Empty results are cached too, so a language with no rows does not reach the database on every request.
- Concurrent misses of one key in one process share one database read (`singleFlight`).
- Reads go to the **primary**, not the read replica: right after a write the cache is emptied and the next reader
  refills it, and a lagging replica would refill it with the replaced text for the whole TTL.
- **After a write**, once the transaction has committed, the entries the changed rows make stale are deleted with one
  `DEL` (a finite set, no `SCAN`). A shared row: the versions of `web`, `mobile` and `all` and the bundles of both
  platforms. A platform row: the versions of that platform and `all`, and that platform's bundle. Nothing is deleted
  when nothing changed.
- A reader that loaded the old rows before the commit and writes them into the cache after the `DEL` leaves the old
  text there until the TTL runs out (at most 10 minutes). Accepted for this release.

## Guest routes

Both are GUEST (the login screen is translated before sign-in), under the tenant prefix, and follow the mobile app's
schema exactly (`expo-react-native-boilerplate` `modules/localization/translation.dto.ts`). The route tests parse every
response through a copy of that schema ([translation.mobile-contract.ts](server/tests/translation.mobile-contract.ts));
change the copy when the app's schema changes.

**`GET …/localization/languages?platform=android|ios|web`** ([route](server/localization-languages.route.ts))

```json
{ "languages": [{ "code": "bg", "name": "Български", "flag": "BG", "versions": { "auth": "1760617854123456-2" } }] }
```

- A language is offered when the tenant enabled it (`defaultLanguage` / `enabledLanguages`, default first) **and** a
  dictionary in code ships it or at least one row exists for that platform. An enabled language with neither is left
  out: the app would see `versions: {}`, consider it complete and show English.
- `versions` lists only the modules with rows for that platform (shared rows plus the platform's).
- **On `android`/`ios`, only the modules the app reads**: the module prefixes of the mobile snapshot
  ([data/mobile.en.json](data/mobile.en.json), 15 modules today). A language seeded for every web module (the
  Bulgarian seed has rows in 133) would otherwise make the app fetch 133 bundles for the 15 it uses. Whether a
  language is offered there is judged over the same modules: a dictionary in code of one of them, or a row in one of
  them; a language with texts only in web modules is not offered to the app. The cached map (`i18n:ver:*`) and the
  version computation are unchanged: the list is filtered after it, so every version it announces is the one the
  bundle carries.
- `web` and no `platform` are not filtered.
- No `platform`: versions over every row. An unknown value (also the internal `mobile`) is a 400.
- `name` is `localization`'s endonym, never empty; `flag` is the ISO 3166 alpha-2 code from `flagCountry()` (the app
  draws the emoji), or null.
- A code with more than one subtag is never offered: the app's schema rejects it, and with it the whole list.
- Which locales the dictionaries ship comes from `@kuraykaraaslan-labs/common/server/dictionary-locales`, generated by
  `registry:snapshot` from the `dictionaries/*.json` file names (server code cannot import the app-layer message map).

**`POST …/localization/languages/{code}`** body `{ "platform": "android"|"ios"|"web", "module": "auth" }`
([route](server/localization-languages-code.route.ts))

```json
{ "code": "bg", "version": "1760617854123456-2", "platform": "ios", "module": "auth", "messages": { "auth.login.title": "Добре дошли" } }
```

- `code` and `platform` are echoed exactly as sent. `android`/`ios` read the `mobile` rows, but `mobile` never appears in
  a response: the app rejects any platform it did not send.
- `messages` holds only the stored rows; the app lays them over its own bundled dictionaries. A module with no rows
  answers `version: "0-0"` and `messages: {}`.
- `version` equals what GET announced for that module and platform.
- 404 when the language is not enabled for the tenant or the module does not exist, and on `android`/`ios` when the
  module is not one the app reads (not in the mobile snapshot, so never in its language list); 400 for a malformed
  code, platform or body. These checks bound the set of cache keys a guest can make the server fill.

**Rate limit.** Both routes use the limiter's `i18n` scope: 600 requests a minute per IP (and 600 at once) in a token bucket of its
own (`rate:i18n:<ip>`), so downloading a language (one GET plus one POST per mobile module, 16 requests today) never spends the
app's `api` budget (120). The tenant plan's `api_rate_limit` does not apply to `i18n`.

**`X-Forwarded-For` must reach the app.** The limiter keys on the first `X-Forwarded-For` address, then `X-Real-IP`. A
reverse proxy or load balancer that sends neither puts **every client on one counter** (`unknown`), so the whole
platform shares 600 requests a minute and language downloads start failing with 429 under ordinary load. Check the
proxy configuration of every deployment.

**Always on.** `translation` is a protected module in `tenant_setting`'s module activation: on for every tenant and
not switchable, because the app downloads its texts before sign-in and the admin layout reads them on every page.

## On the web: no deploy either

**Admin layout.** `resolveAdminI18n` (`app/tenant/[tenantId]/admin/(shell)/_i18n.ts`) lays the stored `web` texts of
the current locale over the generated dictionaries (database > JSON > English, per key) before the messages reach
`<I18nProvider>`, so every `useT()` in the admin sees a corrected text on the next page load. Per render:

- one `getVersionsMany([locale], 'web')`: one MGET for the versions of the current locale;
- one `getBundles(locale, <modules with rows>, 'web')`: one MGET, and one database read for the modules that missed.

The switcher offers every language the tenant enabled, whether or not a dictionary or a stored text covers it: a
key with neither renders in English. When the stored texts cannot be read, the page renders from the dictionaries
alone. (The mobile language list below is stricter: it names only languages a dictionary or a row covers.)

**Server messages.** Emails, notifications and API strings that should pick up stored texts use the async
`loadServerT(dictionaries, locale)` of `i18n` (see its README); `createServerT` stays static. The overlay behind it is
installed by this module's boot task [`registerTranslationOverlay`](server/translation.overlay.ts)
(`common:boot_task`, phase `runtime`) and reads the `web` texts through the cache. No caller uses `loadServerT` yet:
today no notification reads the recipient's language (planned with `user_preferences.language`).

## Tenancy

The texts are **system-wide by design**: the table has no tenant column, the Redis keys have no tenant segment, and
every tenant reads the same texts (decided 2026-10-19). A tenant starts with the platform's languages, and having each
tenant maintain its own copies of them would gain nothing. Tenant-specific texts are not planned.

What stays per tenant is only the choice of which languages to offer: `defaultLanguage` / `enabledLanguages` in
`tenant_setting`, which the guest routes and the admin layout read.

With no tenant column there is nothing for row-level security to isolate on, so the table is classified in the
**EXEMPT** list of [`gen-rls-policies.mts`](../db/scripts/gen-rls-policies.mts) with that reason.
