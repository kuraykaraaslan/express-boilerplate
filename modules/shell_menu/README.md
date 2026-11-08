# shell_menu

The installation's admin sidebar, set by the sysadmin in **Platform → Menu** (`/admin/platform/menu`, root tenant only)
instead of `config/menu.ts` and `app/shell.profile.ts`. Plan and decisions: [docs/phases/54-menu-editor](../../docs/phases/54-menu-editor/README.md).

One menu per installation (system-wide rows, no tenant column), edited as a **draft**, checked with **Preview as**,
made live with **Publish**, every published state kept in the **History** and restorable; **Import / Export** carries
it between environments as one JSON file (`nb-menu/1`).

## What it changes, and what it does not

- Per **layer**: all roles, then the viewer's built-in role (sysadmin, owner, admin, user), then each custom group they
  hold. A layer hides, shows, moves and orders items, groups and workspaces, and can make the sidebar one flat list.
- **Workspaces**: add one (id, name, icon), rename or re-icon a built-in one, reorder, hide per layer, delete an added
  one (its groups and items go back home), move a whole group into another workspace.
- **Custom links**: an admin page (`page`), an outside `https` address with an audience (`url`), or a kind another module
  contributes through `shell_menu:link_target` (the dashboard's `board`, by slug). See "Custom links" below.
- It applies **after** the registry's module and permission filter, so it can never reveal an item. **Hiding is not
  access control**: closing a page for a role stays in `config/access.ts` and the page guard.

## Labels and translation

Every label is a translation key of this module; the built-in keys (`<module>.menu.<id>`, `app_shell.workspace.<id>`,
`app_shell.group.<slug>`) are never written, so seed texts and translators' corrections survive and **Reset** is exact.

| Entry | Key of a rename or a new entry |
|---|---|
| item | `shell_menu.item.<itemId>` |
| workspace | `shell_menu.workspace.<id>` |
| group | `shell_menu.group.<slug>` |
| custom link | `shell_menu.link.<linkId>` |

- The **English** is the `label` in the stored menu (as `en.json` holds a module's English).
- **Other languages** are rows in `translations` (module `shell_menu`, platform shared), written at publish in the same
  transaction as the menu (`TranslationWriteService.upsertManyIn` / `removeManyIn`).
- A viewer sees their language's stored text, else a stored `en` row, else the English.
- Labels do not vary by role (role layers carry none).
- `translation:source`: the published menu's keys are contributed with their English, so **Platform → Translations**
  lists them under this module (source "Set in the app"), counts the missing ones, exports and imports them.
- The editor's languages: English, every language with a dictionary in code or stored texts, and the root tenant's
  enabled ones; "Add language" offers the rest (`localization`'s `LanguageSelect`, flags, right-to-left input).
- Typing an English label another key already has offers that key's translations (`GET /api/shell-menu/suggest`).

## Custom links

| Kind | Target | Shown when |
|---|---|---|
| `page` | `/admin/…` (query allowed), a registered admin page | its module is on and the page guard opens it for the viewer |
| `url` | `https://…`, placeholders `{tenantId}`, `{locale}` | the viewer meets the audience (lowest role and/or a permission; required) |
| `board` (dashboard) | a board slug | the viewer's tenant has a board with that slug they may open, and the dashboard page's guard opens it |

Boards a solution or a template installs share their slug in every tenant (`iot-water-site`), so one link serves them
all; a hand-made board's slug has a random suffix and exists in its own tenant only. A link never grants anything.

## Read path

`ShellMenuReadService.published()`: an in-process copy keyed by the Redis key `shell_menu:version` (bumped by every
publish, restore and import), so an admin page load costs one Redis GET and no query in steady state. The admin layout
(`app/tenant/[tenantId]/admin/(shell)/_menu.ts`) turns it into the viewer's plain sidebar profile
(`shell_menu.profile.ts`: layers, labels, icons; `shell_menu.links.ts`: links). Without a published menu the layout
still reads `config/menu.ts` for one release (deprecated; boot and `config:check` say so).

## Moving a file-based menu in

```
npm run menu:import                                   # preview: config/menu.ts (+ app/shell.profile.ts)
npm run menu:import -- config/menu.ts --write         # publish it as a revision, translated
npm run menu:import -- --file menu.json --write       # a file exported from the editor
```

Options: `--drop-unknown` (leave out entries no current module has), `--replace` (over a published menu),
`--shell-profile <file>` / `--no-shell-profile`. Languages the file does not give are filled from keys with the same
English, each listed with its source key.

## API (GLOBAL scope, root super-admin behind the KD-13 gate)

| Route | Permission |
|---|---|
| `GET /api/shell-menu` (published, draft, problems, stored texts) | `shell_menu.layout.read` |
| `PUT` / `DELETE /api/shell-menu/draft` (etag-checked) | `shell_menu.layout.manage` |
| `GET /api/shell-menu/catalog` | `shell_menu.layout.read` |
| `POST /api/shell-menu/publish` | `shell_menu.layout.manage` |
| `GET /api/shell-menu/revisions`, `GET …/revisions/[revision]` | `shell_menu.layout.read` |
| `POST …/revisions/[revision]/restore` | `shell_menu.layout.manage` |
| `GET /api/shell-menu/export`, `POST /api/shell-menu/import` | read / manage |
| `GET /api/shell-menu/link-targets?kind&q`, `GET /api/shell-menu/suggest?en&languages` | `shell_menu.layout.read` |

Publish, restore, import and discard are audited on the root tenant (`shell_menu.*`). Draft autosaves are not.

## Data

`shell_menus` (at most one `draft` and one `published` row: spec, pending labels, revision, etag) and
`shell_menu_revisions` (append-only: spec, label snapshot, action, note, via). Migration
[001](server/migrations/001_shell_menus.sql); RLS-exempt (system-wide, `modules/db/scripts/rls-exempt.ts`).
