// Application-UI dictionary for mcp_server (Settings → MCP). Keys are module-prefixed; `en` is the source (generated from
// t('key','English') defaults, plus the manifest's menu and permission keys), other locales fill in.
// Collected into the app-layer _generated/ui-messages.ts aggregator by the registry.
import en from './en.json';
import tr from './tr.json';

export const dictionaries: Record<string, Record<string, string>> = { en, tr };
