import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { markableLiterals, type MarkableLiteral } from './feature_gate.pack-mark';

/**
 * Building a protected pack (dashboard phase 33, ADR-0016, P1 and P2). A module declares the packs whose code must not be a public
 * chunk through the metadata point `feature_gate:protected_packs`, one contribution per pack (the key is the pack id):
 *
 *   { entry: 'ui/pieces/scada-pack-home.ts', symbol: 'HOME_DEFS', gate: 'ui/protected/scada-pack-gate.ts',
 *     host: ['@kuraykaraaslan-labs/common/ui/kui/widget-kit/views/svg-node', ...], integerStep: 0.01, decimalShift: 1 }
 *
 * The pack is bundled with esbuild from a small entry: it imports the declared value, verifies the deployment's licence for the
 * page's origin (`ui/protected-pack-licence.ts`, with the vendor keys of this build), and exports what the module's gate makes of
 * the value (the drawings, or grey "Unlicensed" stand-ins). The host modules are not bundled: a pack reads them from the registry
 * the page installs (`globalThis.__KUI_PACK_HOST__`), so it draws with the page's one kit. Any other import that leaves the module's
 * own files fails the build: the list is closed. Type-only imports are erased and never count.
 *
 * A pack may also declare `bundle`: package specifiers that are bundled INTO the pack (not read from the page's registry), for a
 * pack written against an engine API that the page does not provide as a module (the 3D item packs and
 * `@kuraykaraaslan/kui-viewer/designer-kit`, phase 39.01). Only those specifiers, and what they import themselves, are taken in.
 *
 * Used by `scripts/build-protected-packs.mts` (production, through the client obfuscator in hidden mode) and, in development, by the
 * pack route on demand, so both serve the same thing. esbuild is loaded at run time and never bundled into a server chunk.
 */

export const PROTECTED_PACKS_POINT = 'feature_gate:protected_packs';
/** The placeholder of the mark id in a built pack; the pack route replaces it with the download's mark. */
export const MARK_PLACEHOLDER = 'kuimark:0000000000000000';
/** Where the build writes the packs (outside the Next build directory, which a build empties). */
export const PROTECTED_PACKS_DIR = '.protected-packs';

export interface PackDeclaration {
  moduleId: string;
  packId: string;
  /** Module-relative source of the value (`ui/pieces/scada-pack-home.ts`). */
  entry: string;
  /** The named export of the value, or `default`. */
  symbol: string;
  /** Module-relative source of the gate: `export function gate(value, licensed: boolean)`. */
  gate: string;
  /** The module specifiers a pack takes from the page's registry instead of bundling them. */
  host: string[];
  /** The package specifiers bundled into the pack (the closed exception to "only the module's own files"); `[]` for none. */
  bundle: string[];
  integerStep: number;
  decimalShift: number;
}

export interface BuiltPack {
  code: string;
  literals: MarkableLiteral[];
  sha256: string;
}

const ID = /^[a-z][a-z0-9_-]{0,63}$/;
const REL = /^(ui|server)\/[A-Za-z0-9_./-]+\.tsx?$/;
const SYMBOL = /^(default|[A-Za-z_$][A-Za-z0-9_$]*)$/;
const SPECIFIER = /^@[a-z0-9-]+\/[a-z0-9_]+\/[A-Za-z0-9_./-]+$/;
const BUNDLE_SPECIFIER = /^@[a-z0-9-]+\/[a-z0-9-]+(\/[A-Za-z0-9_.-]+)*$/;

/** One contribution as a declaration, or why not. */
export function parsePackDeclaration(moduleId: string, key: string, metadata: unknown): { ok: true; pack: PackDeclaration } | { ok: false; reason: string } {
  if (!ID.test(moduleId) || !ID.test(key)) return { ok: false, reason: `bad module or pack id ${moduleId}:${key}` };
  const m = (metadata ?? {}) as Record<string, unknown>;
  if (typeof m.entry !== 'string' || !REL.test(m.entry) || m.entry.includes('..')) return { ok: false, reason: `${key}: entry must be a ui/ or server/ .ts path` };
  if (typeof m.gate !== 'string' || !REL.test(m.gate) || m.gate.includes('..')) return { ok: false, reason: `${key}: gate must be a ui/ or server/ .ts path` };
  if (typeof m.symbol !== 'string' || !SYMBOL.test(m.symbol)) return { ok: false, reason: `${key}: symbol must be an export name or default` };
  const host = Array.isArray(m.host) ? m.host : [];
  if (!host.every((h): h is string => typeof h === 'string' && SPECIFIER.test(h))) return { ok: false, reason: `${key}: host must list package specifiers` };
  const bundle = Array.isArray(m.bundle) ? m.bundle : [];
  if (!bundle.every((h): h is string => typeof h === 'string' && BUNDLE_SPECIFIER.test(h) && !h.includes('..'))) return { ok: false, reason: `${key}: bundle must list package specifiers` };
  const integerStep = typeof m.integerStep === 'number' ? m.integerStep : 0;
  const decimalShift = typeof m.decimalShift === 'number' ? m.decimalShift : 1;
  if (!(integerStep >= 0 && integerStep < 1) || !Number.isInteger(decimalShift) || decimalShift < 1 || decimalShift > 4) {
    return { ok: false, reason: `${key}: integerStep must be in [0, 1) and decimalShift a whole number from 1 to 4` };
  }
  return { ok: true, pack: { moduleId, packId: key, entry: m.entry, symbol: m.symbol, gate: m.gate, host, bundle, integerStep, decimalShift } };
}

/** Every declaration in the modules of a checkout (`<root>/modules/*\/module.json`); throws on a malformed one. */
export function declarationsFromModules(root: string): PackDeclaration[] {
  const dir = path.join(root, 'modules');
  const out: PackDeclaration[] = [];
  for (const moduleId of fs.readdirSync(dir).sort()) {
    const file = path.join(dir, moduleId, 'module.json');
    if (!fs.existsSync(file)) continue;
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8')) as { extensions?: { point: string; key?: string; metadata?: unknown }[] };
    for (const c of manifest.extensions ?? []) {
      if (c.point !== PROTECTED_PACKS_POINT) continue;
      const parsed = parsePackDeclaration(moduleId, c.key ?? '', c.metadata);
      if (!parsed.ok) throw new Error(`[protected-packs] ${moduleId}: ${parsed.reason}`);
      out.push(parsed.pack);
    }
  }
  return out;
}

/** A vendor key a pack verifies the licence with: the platform keys of `fleet_license/server/license.trust.ts`. */
export interface VendorKey {
  kid: string;
  publicKey: string;
}

export interface BuildOptions {
  root: string;
  vendorKeys: readonly VendorKey[];
  /** Hidden mode: the client obfuscator, given the bundled code and the pack's path. */
  obfuscate?: (code: string, packPath: string) => Promise<string> | string;
}

/** The entry esbuild bundles for one pack (exported for the tests). */
export function packEntrySource(decl: PackDeclaration, root: string): string {
  const abs = (rel: string) => JSON.stringify(path.join(root, 'modules', decl.moduleId, rel));
  const licence = JSON.stringify(path.join(root, 'modules', 'feature_gate', 'ui', 'protected-pack-licence.ts'));
  const value = decl.symbol === 'default' ? `import __value from ${abs(decl.entry)};` : `import { ${decl.symbol} as __value } from ${abs(decl.entry)};`;
  return [
    value,
    `import { gate as __gate } from ${abs(decl.gate)};`,
    `import { checkPackLicence as __check } from ${licence};`,
    `const __licensed = await __check(__KUI_VENDOR_KEYS__);`,
    `export default __gate(__value, __licensed);`,
    `export const mark = ${JSON.stringify(MARK_PLACEHOLDER)};`,
  ].join('\n');
}

/** Bundles one pack and finds its markable literals. */
export async function buildPack(decl: PackDeclaration, options: BuildOptions): Promise<BuiltPack> {
  const esbuild = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ 'esbuild')) as typeof import('esbuild');
  const moduleDir = path.join(options.root, 'modules', decl.moduleId);
  const licenceFile = path.join(options.root, 'modules', 'feature_gate', 'ui', 'protected-pack-licence.ts');
  const host = new Set(decl.host);
  const bundle = new Set(decl.bundle);
  // the directories whose files may be bundled because a declared `bundle` specifier led there (the engine package)
  const bundledRoots = new Set<string>();
  const result = await esbuild.build({
    stdin: { contents: packEntrySource(decl, options.root), resolveDir: moduleDir, loader: 'ts', sourcefile: `${decl.moduleId}/${decl.packId}.entry.ts` },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    legalComments: 'none',
    charset: 'utf8',
    define: { __KUI_VENDOR_KEYS__: JSON.stringify(options.vendorKeys.map(({ kid, publicKey }) => ({ kid, publicKey }))) },
    plugins: [{
      name: 'kui-protected-pack',
      setup(b) {
        b.onResolve({ filter: /.*/ }, async (args) => {
          if (host.has(args.path)) return { path: args.path, namespace: 'kui-host' };
          if (args.kind === 'entry-point') return undefined;
          if (args.pluginData?.kuiBundleProbe) return undefined; // our own `resolve` below: esbuild's default resolution
          if (bundle.has(args.path)) {
            const resolved = await b.resolve(args.path, { resolveDir: args.resolveDir, kind: args.kind, pluginData: { kuiBundleProbe: true } });
            if (resolved.errors.length > 0) return { errors: resolved.errors };
            bundledRoots.add(bundledRootOf(resolved.path));
            return { path: resolved.path };
          }
          // what a bundled specifier imports itself (its own chunks, and the packages it depends on) is taken in with it
          if (args.importer && [...bundledRoots].some((r) => args.importer === r || args.importer.startsWith(r + path.sep))) {
            if (args.path.startsWith('.') || path.isAbsolute(args.path)) return undefined;
            const dep = await b.resolve(args.path, { resolveDir: args.resolveDir, kind: args.kind, pluginData: { kuiBundleProbe: true } });
            if (dep.errors.length > 0) return { errors: dep.errors };
            bundledRoots.add(bundledRootOf(dep.path));
            return { path: dep.path };
          }
          if (args.path.startsWith('.') || path.isAbsolute(args.path)) {
            const target = path.resolve(args.resolveDir, args.path);
            const inside = (dir: string) => target === dir || target.startsWith(dir + path.sep);
            if (inside(moduleDir) || target === licenceFile || target === licenceFile.replace(/\.ts$/, '')) return undefined;
            return { errors: [{ text: `a protected pack may import only its own module's files (${args.path} from ${args.importer})` }] };
          }
          return { errors: [{ text: `${args.path} is not in the pack's host list (imported by ${args.importer}); a protected pack bundles only its own files` }] };
        });
        b.onLoad({ filter: /.*/, namespace: 'kui-host' }, (args) => ({
          contents: `module.exports = globalThis.__KUI_PACK_HOST__[${JSON.stringify(args.path)}];`,
          loader: 'js',
        }));
      },
    }],
    logLevel: 'silent',
  });
  let code = result.outputFiles[0]!.text;
  if (options.obfuscate) code = await options.obfuscate(code, `${decl.moduleId}/${decl.packId}.js`);
  if (!code.includes(MARK_PLACEHOLDER)) throw new Error(`[protected-packs] ${decl.moduleId}/${decl.packId}: the mark placeholder did not survive the build`);
  const literals = markableLiterals(code, { integerStep: decl.integerStep, decimalShift: decl.decimalShift });
  return { code, literals, sha256: createHash('sha256').update(code).digest('hex') };
}

/** The directory every file of a bundled specifier lives under: its package folder in node_modules (a file outside node_modules: its own folder). */
function bundledRootOf(resolvedFile: string): string {
  const marker = `${path.sep}node_modules${path.sep}`;
  const at = resolvedFile.lastIndexOf(marker);
  if (at >= 0) {
    const rest = resolvedFile.slice(at + marker.length).split(path.sep);
    return resolvedFile.slice(0, at + marker.length) + rest.slice(0, rest[0]!.startsWith('@') ? 2 : 1).join(path.sep);
  }
  return path.dirname(resolvedFile);
}

/** Where a built pack lives under a checkout or a standalone output. */
export const builtPackPaths = (root: string, moduleId: string, packId: string) => {
  const base = path.join(root, PROTECTED_PACKS_DIR, moduleId, packId);
  return { code: `${base}.js`, literals: `${base}.json` };
};
