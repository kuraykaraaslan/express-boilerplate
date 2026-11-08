# tour

Guided tours on the module pages (docs/phases/59-guided-tours). Core edition, core placement. No server routes, no
tables: tours are files in the modules, checked at build time, drawn in the browser.

## Writing a tour

1. Put `data-tour="<module>.<name>"` on the elements the steps point at, in the module's own `ui/` code:
   ```tsx
   <Button data-tour="iot_rules.new-rule" onClick={…}>New rule</Button>
   // a PageHeader action takes it as a prop
   actions={[{ label: 'New rule', onClick, dataTour: 'iot_rules.new-rule' }]}
   ```
   A part of a **vendored kit component** (the widget-kit `SceneEditor`, a kui panel) cannot take an anchor: name its
   `data-testid` instead, `"target": "testid:panel-palette"` (D59-E10). The build checks it exists in the code too.
2. Write `modules/<module>/tours/<tour-id>.tour.json` (the editor validates and completes it through `$schema`):
   ```json
   {
     "$schema": "../../tour/tour.schema.json",
     "format": 1,
     "id": "first-rule",
     "version": 1,
     "title": "Create your first rule",
     "start": "/admin/iot/rules",
     "permissions": ["iot_rules.manage"],
     "steps": [
       { "id": "new", "target": "iot_rules.new-rule", "title": "New rule", "text": "Start a rule here.", "placement": "bottom", "advanceOn": "click" },
       { "id": "trigger", "route": "/admin/iot/rules/[ruleId]", "target": "iot_rules.trigger", "text": "Pick what starts the rule.", "waitFor": 5000 },
       { "id": "done", "title": "That is all", "text": "Open this tour again from the Tours button." }
     ]
   }
   ```
3. `node scripts/i18n/extract.mjs --tours <module>` writes the texts into the module's `dictionaries/en.json` as
   `<module>.tour.<tour>.title`, `<module>.tour.<tour>.<step>.title` and `.text`. Translate them in
   `dictionaries/<lang>.json` (or Platform → Translations); the untranslated-text tests cover them like any key.
4. `npm run registry:snapshot` builds the list; `npm run check:tours` must say 0 problems.

| Field | Meaning |
|---|---|
| `id` | unique in the module; the file is `<id>.tour.json` |
| `version` | raise it when the screens change: people who finished or skipped an older version are offered it again |
| `start` | the admin page (no `[params]`) the tour starts on, is offered on and opens from the drawer |
| `offer` | `false`: never offered on a first visit, only from the drawer |
| `permissions` | any-of; besides, the module must be on for the workspace |
| step `target` | a `data-tour` anchor, or `testid:<id>` for a vendored component's `data-testid`; omitted = a centred step |
| step `route` | the page the step is on; a concrete route is opened, one with `[params]` waits for the reader (a click on the previous target) |
| step `advanceOn: "click"` | clicking the highlighted element also moves on |
| step `waitFor` | ms to wait for a late target (default 3000), then the step is centred |
| step `interactive` | `true`: the page stays usable while the step shows (the reader works in a drawer, a dialog or on the canvas the step only points at). Default: only the highlighted element can be used, so its anchor must hold every control the step asks for |

Change a step's `id` when its meaning changes: the old translation then falls away instead of staying under new English.

Example: [`dashboard_scada/tours/first-diagram.tour.json`](../dashboard_scada/tours/first-diagram.tour.json) is a full
tutorial: New diagram → name → Create, four symbols joined by three lines and named in the editor, Save, Close, then the
device list → the device → Views → Choose a drawing → pick it → link each symbol to a device value (or Match everything…) →
the live values.

Inside a modal host (the diagram editor is a Radix dialog) the popover and the overlay move into the dialog, so its focus
trap lets the keyboard reach the tour (D59-E13). → and ← move the tour only on its popover or the bare page; in the editor's
canvas they stay the editor's (they nudge the selected symbol).

## What the build checks (`scripts/registry/tours.mjs`)

The schema; the file name; unique step ids; every `target` present as a `data-tour` anchor in some module's `ui/` or
`app/` (a renamed button fails the build, not the customer's tour); `start` and every `route` an admin page of this
build; the module has a dictionary and its `en.json` holds every tour text with the same English. A tour with a problem
is left out of the snapshot (warned); `npm run check:tours` (in `build:prepare`) and
`scripts/registry/tests/tours.test.ts` fail.

## In the browser

`ui/tour-topbar.component.tsx` is this module's contribution to `app_shell.topbar` (draws nothing while no tour is open
to the reader):

- a **Tours** button opening a drawer: this page's tours, then the others, with Start / Start again and the status;
- a small card offering this page's tour once, on the first visit (Start the tour / Not now);
- the kui-react `Tour` (vendored into `common/ui/kui/tour` by `scripts/kui/vendor-tour.mjs`; Driver.js draws, text only,
  keyboard, RTL from `localization`), opening the next step's page when it is a concrete route and resuming after a reload.

Progress (finished / skipped, with the tour version) is kept per browser and workspace in `localStorage`; a running tour
in `sessionStorage`. Nothing is sent to the server.
