# modules/app — App-Level Patterns

Page-section partials (organisms + shells) composed from `modules/ui/`. May orchestrate layout, navigation, or local UI flow. Still server-rendered EJS; no external data fetching here.

## Files

```
AccessibilityKit.ejs   AppBreadcrumbs.ejs    AppCommandBar.ejs
AppDrawer.ejs          AppFooter.ejs         AppNav.ejs
AppShell.ejs           AppSidebar.ejs        AppTopBar.ejs
DetailHeader.ejs       ErrorState.ejs        FilterBar.ejs
Form.ejs               FormField.ejs         GlobalSearch.ejs
InlineAlert.ejs        LoadingState.ejs      NavDrawer.ejs
NoAccessState.ejs      NotFoundState.ejs     NotificationSystem.ejs
SectionCard.ejs        SplashScreen.ejs      StepFlow.ejs
StepShell.ejs          ThemeSwitcher.ejs
```

## Parity

Shared with NextJS: yes — counterpart is `$KUIREACT_ROOT/modules/app/`. Naming, props (locals), and rendered DOM must match the React versions. Mirror any add/rename/remove in both repos.

## Conventions

1. **Header destructure** — `<% const { title, items = [], ... } = locals; %>` at the top of every partial.
2. **Icons** — Font Awesome only: `<i class="fa-solid fa-bars" aria-hidden="true"></i>`.
3. **Interactivity** — React `useState`/effects translate to a vanilla-JS IIFE attached to the partial's root `id` or `data-*` selector. No client framework, no global handlers.
4. **Shared tokens** — Tailwind utilities mapped to CSS variables in `public/assets/css/input.css`; never hardcode color values.
5. **Compose, don't reinvent** — pull primitives from `modules/ui/` via `<%- include('../ui/Button', { ... }) %>` instead of duplicating markup.
6. **A11y** — `<main id="main-content">`, `SkipLink`, `aria-label` on icon-only triggers, focus traps in drawers/modals.

## See also

- Repo conventions: [`$KUIEJS_ROOT/AGENTS.md`](../../AGENTS.md)
- Parity contract & pixel-perfect rule: the rulesets referenced for `$KUIEJS_ROOT` in `internal-ai-rules/LOCAL_PATHS.json`
