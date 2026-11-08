// The sandboxed plugin manifest contract, shared by every bundle source (OD-139,
// docs/phases/35-editions-licensing): the Enterprise marketplace (publish/review)
// and the Core operator store (plugin_local). Pure apart from the extension
// registry lookup for the EXT-8 check. marketplace_developer/server/publish.helpers
// re-exports everything here from its old path.
//
//   parseManifest           the marketplace's contract: id/name/version, optional
//                           declarative block/widget, EXT-8 points. `.passthrough()`.
//   parseSandboxedManifest  parseManifest + a STRICT `sandbox` block (runtime,
//                           capabilities ⊆ CAPABILITY_SURFACE, hostnames, numeric
//                           limits), no block.serverHandler, no widget.script.
//                           Used by plugin_local; the marketplace still validates
//                           the sandbox at review time.

import { z } from 'zod';
import { extensionRegistry } from '@kuraykaraaslan-labs/common/server/extension-registry';
import { ALL_CAPABILITIES, type Capability } from '../../sdk/types';
import type { SandboxConfig } from '../rpc/protocol';

// Semver with an optional pre-release suffix (e.g. 1.2.0-beta.1).
export const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export type ParsedSemver = { major: number; minor: number; patch: number; pre: string | null };

export function parseSemver(input: string): ParsedSemver | null {
  const m = SEMVER_RE.exec(input.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ?? null };
}

/** SemVer precedence: -1 if a<b, 0 if equal, 1 if a>b. A release outranks a pre-release of the same x.y.z. */
export function compareSemver(a: ParsedSemver, b: ParsedSemver): number {
  for (const k of ['major', 'minor', 'patch'] as const) {
    if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
  }
  if (a.pre === b.pre) return 0;
  if (a.pre === null) return 1; // release > pre-release
  if (b.pre === null) return -1;
  return a.pre < b.pre ? -1 : a.pre > b.pre ? 1 : 0;
}

/** The highest of a list of version strings (unparseable ones ignored), or null. */
export function highestSemver(versions: string[]): ParsedSemver | null {
  return versions
    .map((v) => parseSemver(v))
    .filter((v): v is ParsedSemver => v !== null)
    .sort(compareSemver)
    .pop() ?? null;
}

export const formatSemver = (v: ParsedSemver): string => `${v.major}.${v.minor}.${v.patch}${v.pre ? `-${v.pre}` : ''}`;

// A DECLARATIVE page-builder block a listing can ship (no code bundle): an HTML
// template with {{token}}s and an optional client script. On install it is
// materialized as a per-tenant `dynamic_page_blocks` row and renders like a
// first-party DB/template block. Mirrors dynamic_page's CreateBlockDTO (minus
// server-set fields). Validated at submit so a malformed declarative block is
// caught before review.
//
// `serverHandler` stays parseable for LEGACY versions only. Third-party server
// code must ship as a sandboxed bundle — it runs in the plugin_runtime isolate;
// dynamic_page's block-action `vm` is NOT a security boundary. New submissions
// carrying one are rejected (MANIFEST_SERVER_HANDLER_REJECTED), install strips
// it, and the block-action route refuses marketplace-sourced handlers.
export const manifestBlockSchema = z.object({
  type: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/, 'block.type: letters, numbers, _ and - only'),
  label: z.string().min(1).max(200),
  category: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  schema: z.record(z.string(), z.unknown()).optional(),
  defaultProps: z.record(z.string(), z.unknown()).optional(),
  template: z.string().max(200000).optional(),
  script: z.string().max(200000).optional(),
  serverHandler: z.string().max(200000).optional(),
  allowedCollections: z.array(z.string()).max(50).optional(),
});
export type ManifestBlock = z.infer<typeof manifestBlockSchema>;

/**
 * A declarative dashboard WIDGET a listing may ship.
 *
 * Mirrors `manifestBlockSchema` where the concepts are the same, and diverges on
 * the one that matters: **`script` is not accepted here.** dp's block schema takes
 * it and the installer copies it, because dp injects it host-side on a public
 * page. A widget renders on `/admin`, where injecting author JS into the host tree
 * would run it inside every admin's authenticated session — so `dashboard_widgets`
 * has no `script` column at all and a widget's JS travels inside its template,
 * which runs in an opaque-origin frame. See modules/dashboard/POSTURE.md §1–3.
 *
 * `.strict()`, unlike the block schema: the outer manifest is `.passthrough()`, so
 * without it the rejections below would be silently dropped instead of refused.
 * Provenance (`isSystem`, `source`, `listingId`, `listingVersion`, `status`) and
 * the tier-1/tier-3 pointers (`componentId`, `frameListingId`) are server-set —
 * a listing that could name a `componentId` could mount any first-party component.
 *
 * There is deliberately no `workspace`: a materialized widget lands in the tenant's
 * LIBRARY, and somebody places it. A plugin does not get to mount itself onto
 * everyone's dashboard on install.
 */
export const manifestWidgetSchema = z.object({
  type: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/, 'widget.type: letters, numbers, _ and - only'),
  label: z.string().min(1).max(200),
  category: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  schema: z.record(z.string(), z.unknown()).optional(),
  defaultProps: z.record(z.string(), z.unknown()).optional(),
  template: z.string().max(200000).optional(),
  /** Only the two tiers a third party may ship. `component` is first-party code. */
  renderTier: z.enum(['template', 'iframe']).optional(),
  defaultW: z.number().int().min(1).max(12).optional(),
  defaultH: z.number().int().min(1).max(48).optional(),
  icon: z.string().max(64).optional(),
}).strict();
export type ManifestWidget = z.infer<typeof manifestWidgetSchema>;

export const MANIFEST_WIDGET_SCRIPT_REJECTED =
  'widget.script is not supported: a dashboard widget renders on the admin surface, where host-page '
  + 'script would execute inside every administrator\'s authenticated session. Put your JavaScript inside '
  + 'the widget template — it runs in an opaque-origin frame — or ship the widget as a sandboxed bundle.';

export const MANIFEST_SERVER_HANDLER_REJECTED =
  'block.serverHandler is not supported: third-party server code must ship as a sandboxed bundle '
  + '(it runs only in the plugin_runtime isolate, never in-process). Ship the block as template+script '
  + 'and move server logic into the bundle.';

// Minimal module.json contract a submitted manifest must satisfy (mirrors
// modules/module.schema.json's required fields + id/version patterns).
const manifestSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/, 'id must be lowercase letters/digits/underscores'),
    name: z.string().min(1),
    version: z.string().regex(SEMVER_RE, 'version must be semver x.y.z (optional -prerelease)'),
    // Optional declarative page-builder block (see manifestBlockSchema).
    block: manifestBlockSchema.optional(),
    widget: manifestWidgetSchema.optional(),
  })
  .passthrough();

export type ParsedManifest = z.infer<typeof manifestSchema>;

/**
 * EXT-8 (docs/phases/37-extensions/07): community code may contribute only to points that declare
 * `external: true`. Checked at publish so a publisher learns it at once; the bridge refuses the rest at runtime too.
 * An unknown point is refused as well — a typo would otherwise publish a plugin that silently does nothing.
 */
export function nonExternalPoints(
  manifest: unknown,
  isExternal: (pointId: string) => boolean | undefined = (id) => extensionRegistry.getPoint(id)?.external,
): string[] {
  const extensions = (manifest as { extensions?: unknown } | null)?.extensions;
  const list = Array.isArray(extensions) ? extensions : [];
  const refused = new Set<string>();
  for (const ext of list) {
    const point = (ext as { point?: unknown })?.point;
    if (typeof point !== 'string' || isExternal(point) !== true) refused.add(String(point));
  }
  return [...refused];
}

export function parseManifest(manifestJson: string): ParsedManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(manifestJson);
  } catch {
    throw new Error('manifest is not valid JSON');
  }
  const res = manifestSchema.safeParse(raw);
  if (!res.success) {
    throw new Error(`invalid manifest: ${res.error.issues.map((i) => i.message).join('; ')}`);
  }
  const refused = nonExternalPoints(res.data);
  if (refused.length) {
    throw new Error(`invalid manifest: these extension points do not accept community plugins: ${refused.join(', ')}`);
  }
  return res.data;
}

// ── Strict sandbox validation ──────────────────────────────────────────────

export type SandboxLimits = SandboxConfig['limits'];
export const LIMIT_KEYS = ['memoryMb', 'timeoutMs', 'httpTimeoutMs', 'httpMaxBytes'] as const satisfies ReadonlyArray<keyof SandboxLimits>;

/** The grant a sandboxed plugin asks for (manifest) or was given (an operator's approval). */
export interface SandboxGrant {
  capabilities: Capability[];
  /** Hostnames (optionally `:port`) `host.http.fetch` may reach, compared to `URL.host` by the broker. */
  httpAllowlist: string[];
  /** Plugin setting keys whose https URL value adds that host to the allowlist, per tenant. */
  httpAllowlistFromSettings: string[];
  limits: Partial<SandboxLimits>;
}

/** A lowercase DNS hostname of at least two labels, optionally with a port. No scheme, path, wildcard or userinfo. */
const HOSTNAME_RE = /^(?=.{1,253}(?::\d{1,5})?$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?::(\d{1,5}))?$/;
const SETTING_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/;
const MAX_ALLOWLIST = 50;

/** Inclusive bounds a declared or approved limit must fall in, before any platform cap. */
const LIMIT_BOUNDS: Record<keyof SandboxLimits, [number, number]> = {
  memoryMb: [8, 4096],
  timeoutMs: [100, 600_000],
  httpTimeoutMs: [100, 600_000],
  httpMaxBytes: [1, 100_000_000],
};

export function isValidAllowlistHost(host: string): boolean {
  const m = HOSTNAME_RE.exec(host);
  if (!m) return false;
  return m[1] === undefined || (Number(m[1]) >= 1 && Number(m[1]) <= 65535);
}

const sandboxSchema = z.object({
  runtime: z.literal('isolated', { message: "sandbox.runtime must be 'isolated'" }),
  capabilities: z.array(z.string()).max(ALL_CAPABILITIES.length).default([]),
  httpAllowlist: z.array(z.string()).max(MAX_ALLOWLIST).default([]),
  httpAllowlistFromSettings: z.array(z.string()).max(MAX_ALLOWLIST).default([]),
  limits: z.record(z.string(), z.unknown()).default({}),
}).strict();

const grantSchema = sandboxSchema.omit({ runtime: true });

/**
 * Validate a sandbox block (or an approved grant, `requireRuntime: false`) strictly and return it normalised.
 * Throws an Error naming every problem. Never widens anything: unknown capabilities, hosts that are not plain
 * hostnames, unknown limit keys and out-of-range numbers are refused, not dropped.
 */
export function validateSandbox(raw: unknown, opts: { requireRuntime?: boolean; settingKeys?: string[] } = {}): SandboxGrant {
  const schema = opts.requireRuntime === false ? grantSchema : sandboxSchema;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid sandbox: must be an object');
  const res = schema.safeParse(raw);
  if (!res.success) {
    throw new Error(`invalid sandbox: ${res.error.issues.map((i) => `${i.path.join('.') || 'sandbox'}: ${i.message}`).join('; ')}`);
  }
  const problems: string[] = [];
  const known = new Set<string>(ALL_CAPABILITIES);
  const capabilities = [...new Set(res.data.capabilities)];
  for (const c of capabilities) if (!known.has(c)) problems.push(`unknown capability '${c}'`);

  const httpAllowlist = [...new Set(res.data.httpAllowlist)];
  for (const h of httpAllowlist) if (!isValidAllowlistHost(h)) problems.push(`httpAllowlist entry '${h}' is not a hostname`);

  const httpAllowlistFromSettings = [...new Set(res.data.httpAllowlistFromSettings)];
  for (const k of httpAllowlistFromSettings) {
    if (!SETTING_KEY_RE.test(k)) problems.push(`httpAllowlistFromSettings entry '${k}' is not a setting key`);
    else if (opts.settingKeys && !opts.settingKeys.includes(k)) problems.push(`httpAllowlistFromSettings entry '${k}' is not a declared config setting`);
  }
  if ((httpAllowlist.length || httpAllowlistFromSettings.length) && !capabilities.includes('http')) {
    problems.push('httpAllowlist needs the http capability');
  }

  const limits: Partial<SandboxLimits> = {};
  for (const [k, v] of Object.entries(res.data.limits)) {
    if (!(LIMIT_KEYS as readonly string[]).includes(k)) { problems.push(`unknown limit '${k}'`); continue; }
    const [min, max] = LIMIT_BOUNDS[k as keyof SandboxLimits];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
      problems.push(`limit '${k}' must be an integer between ${min} and ${max}`);
      continue;
    }
    limits[k as keyof SandboxLimits] = v;
  }
  if (problems.length) throw new Error(`invalid sandbox: ${problems.join('; ')}`);
  return { capabilities: capabilities as Capability[], httpAllowlist, httpAllowlistFromSettings, limits };
}

/** Every limit at most the platform's maximum (a missing one becomes the maximum). */
export function capLimits(requested: Partial<SandboxLimits>, max: SandboxLimits): SandboxLimits {
  const out = { ...max };
  for (const k of LIMIT_KEYS) {
    const v = requested[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.min(v, max[k]);
  }
  return out;
}

export interface ManifestFieldDecl {
  key: string;
  label?: string;
  help?: string;
  placeholder?: string;
}

export interface ManifestExtensionDecl {
  point: string;
  key: string;
  metadata: Record<string, unknown>;
}

export interface SandboxedManifest {
  manifest: ParsedManifest;
  sandbox: SandboxGrant;
  config: { settings: ManifestFieldDecl[]; secrets: ManifestFieldDecl[] };
  extensions: ManifestExtensionDecl[];
}

const fieldSchema = z.object({
  key: z.string().regex(SETTING_KEY_RE, 'config keys: a letter, then letters, digits, _ . -'),
  label: z.string().max(200).optional(),
  help: z.string().max(1000).optional(),
  placeholder: z.string().max(200).optional(),
}).strict();
const configSchema = z.object({
  settings: z.array(fieldSchema).max(100).default([]),
  secrets: z.array(fieldSchema).max(100).default([]),
}).strict();
const extensionSchema = z.object({
  point: z.string().min(1),
  key: z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,63}$/, 'extension key: lowercase letters, digits, _ . -'),
  metadata: z.record(z.string(), z.unknown()).default({}),
}).strict();

/**
 * A sandboxed bundle's manifest, validated strictly (OD-139). On top of `parseManifest`: a `sandbox` block
 * is required and checked by `validateSandbox`; `config` and `extensions` are typed; `block.serverHandler`
 * and `widget.script` are refused exactly as the marketplace refuses them at submit.
 */
export function parseSandboxedManifest(manifestJson: string): SandboxedManifest {
  const manifest = parseManifest(manifestJson);
  const raw = manifest as ParsedManifest & { sandbox?: unknown; config?: unknown; extensions?: unknown };
  if (manifest.block?.serverHandler) throw new Error(MANIFEST_SERVER_HANDLER_REJECTED);
  if (manifest.widget && 'script' in (manifest.widget as Record<string, unknown>)) throw new Error(MANIFEST_WIDGET_SCRIPT_REJECTED);
  const config = configSchema.safeParse(raw.config ?? {});
  if (!config.success) throw new Error(`invalid manifest config: ${config.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  const extensions = z.array(extensionSchema).max(50).safeParse(raw.extensions ?? []);
  if (!extensions.success) throw new Error(`invalid manifest extensions: ${extensions.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  if (raw.sandbox === undefined) throw new Error('invalid sandbox: a sandboxed plugin must declare a sandbox block');
  const sandbox = validateSandbox(raw.sandbox, { settingKeys: config.data.settings.map((s) => s.key) });
  return { manifest, sandbox, config: config.data, extensions: extensions.data };
}
