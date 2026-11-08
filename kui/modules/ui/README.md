# modules/ui — UI Primitives

Stateless or locally-stateful EJS partials (atoms + molecules). No business logic, no data fetching. Consumed by `modules/app/`, `modules/domain/`, and `views/theme/`.

## Files

```
AdvancedDataTable.ejs   AlertBanner.ejs        Avatar.ejs
Badge.ejs               BrandLogo.ejs          Breadcrumb.ejs
Button.ejs              ButtonGroup.ejs        Card.ejs
Checkbox.ejs            CheckboxGroup.ejs      ComboBox.ejs
ConfirmDialog.ejs       ConfirmHost.ejs        ContentScoreBar.ejs
DataTable.ejs           DatePicker.ejs
DateRangePicker.ejs     Drawer.ejs             DropdownMenu.ejs
EmptyState.ejs          FileInput.ejs          Input.ejs
MapView.ejs             Modal.ejs              MultiSelect.ejs
PageHeader.ejs          Pagination.ejs         Popover.ejs
RadioGroup.ejs          SearchBar.ejs          Select.ejs
ServerDataTable.ejs     Skeleton.ejs           SkipLink.ejs
Slider.ejs              Spinner.ejs            StarRating.ejs
StatCard.ejs            Stepper.ejs            TabButton.ejs
TabGroup.ejs            Table.ejs              TagInput.ejs
Textarea.ejs            TimeWindowPicker.ejs   TimeWindowSelect.ejs
Toast.ejs               Toggle.ejs             Tooltip.ejs
TreeView.ejs            VideoPlayer.ejs        ViewToggle.ejs
lazy.ejs

ConfirmDialog/ _runtime.ejs (inlines scripts/confirm-dialog.js once per page: window.KuiConfirm)
Chart/         Chart.ejs + partials/ + scripts/ (line, bar, area, pie, donut, sparkline, gauge, heatmap, time axis)
ControlTile/   ControlTile.ejs, ControlSwitch / ControlSlider / ControlSetpoint / ControlButton.ejs, scripts/
MapView/       MapView.ejs (framed) + MapCanvas.ejs (card-less)
TimeWindowPicker/  _shared.ejs (messages, calendar periods, zone list; also used by TimeWindowSelect)
TimeWindowSelect/  _trigger.ejs, _panel.ejs, _logic.ejs (server twin of scripts/time-window-logic.js), scripts/
```

## Confirmations

| Component | File | Notes |
|---|---|---|
| ConfirmDialog | `ConfirmDialog.ejs` + `ConfirmDialog/scripts/confirm-dialog.js` | **The** confirmation (kui-react `ConfirmDialog`): `id`, `open`, `title`, `message`, `tone` (default\|warning\|danger), `confirmLabel`, `cancelLabel`, `secondaryLabel`, `details`, gates `input` (text\|textarea\|date\|number, `required`, `minLength`, `min`, `max`, `step`), `acknowledgement` (responsibility text to tick), `phrase` (typed exactly), `confirmDisabled` (a gate of the caller's own), `busy`, `error`; data hooks `data-confirm-action` / `-cancel` / `-secondary` / `-message`. Opened with `KuiConfirm.open(id)` (Promise of `{ value, choice }` or `null`) or a `[data-kui-confirm-open="<id>"]` trigger; the root dispatches `confirm-dialog:confirm` / `confirm-dialog:cancel`. Imperative: `KuiConfirm.confirmDialog(options)` (also `window.confirmDialog`), `action` runs inside the dialog, `KuiConfirm.cancelAllConfirms()`. Declarative: `<form data-kui-confirm="<options JSON>">` asks before it submits. Never `window.confirm` / `window.prompt` |
| ConfirmHost | `ConfirmHost.ejs` | Mounts the confirmation runtime once per page (kui-react `<ConfirmHost />`); `views/layouts/main.ejs` and `blank.ejs` include it. Several copies on a page share one queue (`Symbol.for('kui.confirmDialog')`) and the first draws |
| Popconfirm | `Popconfirm.ejs` | **Deprecated for confirmations** (use ConfirmDialog): `trigger`, `title`, `description`, `danger`, `confirmLabel`, `cancelLabel` |

## Parity

Shared with NextJS: yes — counterpart is `$KUIREACT_ROOT/modules/ui/`. Component names, props, and visual output must remain pixel-perfect. When you add or change a primitive in either repo, mirror it here.

## Conventions

1. **Header destructure** — every partial begins with `<% const { propA = default, propB } = locals; %>` so missing locals don't throw.
2. **Icons** — Font Awesome via `<i class="fa-solid fa-..." aria-hidden="true"></i>`. No inline SVG, no other icon libs.
3. **No React state** — interactive behavior is rendered as a vanilla-JS IIFE (`<script>(function(){ ... })();</script>`) scoped to a unique `id`/`data-` attribute.
4. **Tokens only** — use Tailwind utilities backed by shared CSS variables (`bg-primary`, `text-text-secondary`, `border-border-focus`); never raw hex.
5. **Escaping** — `<%= %>` for any value that could come from data; `<%- %>` only for trusted HTML / pre-rendered partials (see `docs/reference/raw-output-allowlist.md`).
6. **Accessibility** — `focus-visible:ring-2 focus-visible:ring-border-focus`, ARIA attributes (`aria-busy`, `aria-invalid`, `aria-expanded`), `disabled:opacity-50 disabled:cursor-not-allowed`.

## See also

- Repo conventions: [`$KUIEJS_ROOT/AGENTS.md`](../../AGENTS.md)
- Parity contract & pixel-perfect rule: the rulesets referenced for `$KUIEJS_ROOT` in `internal-ai-rules/LOCAL_PATHS.json`
