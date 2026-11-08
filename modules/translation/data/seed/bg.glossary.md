# Bulgarian UI translation: rules and glossary

Product: a multi-tenant business SaaS (admin panel on the web, plus a mobile app). Readers: office staff and
administrators of a Bulgarian customer. Write natural, modern Bulgarian as used in business software.

## Rules
- Address the user formally (Вие form: "Въведете", "Изберете", "Вашият"), never "ти".
- Buttons and menu items: short. Use the imperative for actions ("Запази", "Изтрий", "Добави"),
  nouns for headings and menu entries ("Настройки", "Потребители").
- Sentence case, like the English. No Title Case. Do not add a final period where the English has none.
- Keep EXACTLY every placeholder and tag as written: `{{count}}`, `{{name}}`, `{x}`, `${x}`, `<b>`, `</b>`, `<br/>`.
  Never translate or rename the word inside them; move them where Bulgarian grammar needs.
- Keep untranslated: product/brand/protocol names and codes (Slack, Google, OAuth, SAML, SCIM, SMTP, SMS, API, JSON,
  CSV, URL, IP, CORS, reCAPTCHA, IBAN, SKU, SIP, MFA, SSO, ABAC, Webhook URL fields, file extensions), and values that
  are literal tokens (e.g. "DELETE" the user must type, "GET", "POST", cron expressions, example URLs, emails).
- Plurals with `{{count}}`: one form is used for all numbers; write it so it reads well with any number
  (e.g. "{{count}} елемента" / "Елементи: {{count}}").
- Units and dates: keep the placeholder; Bulgarian uses "ч." "мин." "сек." "дни".
- Ellipsis "…" stays. Quotes: use „…“ for quoted words in sentences.
- Do not leave English unless it is one of the kept names above.

## Glossary (use these consistently)
| English | Bulgarian |
|---|---|
| tenant, organization | организация |
| workspace | работно пространство |
| user | потребител |
| member | член |
| invitation / invite | покана / покани |
| role | роля |
| permission | разрешение |
| group | група |
| dashboard | табло |
| widget | джаджа |
| settings | настройки |
| module | модул |
| sign in / log in | вход / влезте |
| sign out | изход |
| sign up / register | регистрация |
| password | парола |
| two-factor authentication | двуфакторно удостоверяване |
| authentication | удостоверяване |
| session | сесия |
| device | устройство |
| email (noun) | имейл |
| notification | известие |
| audit log | журнал на одита |
| webhook | уебхук |
| API key | API ключ |
| token | токен |
| subscription | абонамент |
| plan | план |
| billing | фактуриране |
| invoice | фактура |
| payment | плащане |
| customer | клиент |
| lead | потенциален клиент |
| opportunity | възможност |
| order | поръчка |
| product | продукт |
| cart | количка |
| inventory / stock | наличност |
| warehouse | склад |
| report | отчет |
| export / import | експортиране / импортиране (buttons: "Експортирай" / "Импортирай") |
| upload / download | качване / изтегляне (buttons: "Качи" / "Изтегли") |
| save / cancel / delete / edit / add / create / close / back | Запази / Отказ / Изтрий / Редактирай / Добави / Създай / Затвори / Назад |
| search / filter | търсене / филтър |
| enabled / disabled | включено / изключено |
| active / inactive | активен / неактивен |
| loading… | Зареждане… |
| failed to … / could not … | Неуспешно … / Не можа да … |
| required | задължително |
| optional | по избор |
| draft | чернова |
| published | публикуван |
| status | статус |
| overview | преглед |
| details | подробности |
| automation | автоматизация |
| workflow | работен поток |
| trigger | задействане |
| fleet (of servers/agents) | флот |
| node | възел |
| agent (software) | агент |
| release | версия |
| metric | метрика |
| alert | сигнал |
| incident | инцидент |
| on-call | дежурство |
| employee | служител |
| leave (time off) | отпуск |
| payroll | ведомост за заплати |
| shift | смяна |
| attendance | присъствие |
| translation | превод |
| language | език |
