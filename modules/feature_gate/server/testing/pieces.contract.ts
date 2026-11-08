import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { FEATURE_GATE_PIECES_POINT, parsePieceContribution, pieceFeatureKey, pieceProductKey, type DeclaredPiece } from '../feature_gate.pieces';

/**
 * The contract-test kit of `feature_gate:pieces` (`@kuraykaraaslan-labs/feature_gate/testing`): what a module that declares sellable
 * pieces checks in its own tests. It returns problems instead of throwing, so a test reads `expect(checkPieceDeclarations(...)).toEqual([])`
 * and a failure lists every problem at once. Test-only: it reads the module.json and package.json files of the tree.
 *
 * The selling and grandfathering halves of the standard are tenant_subscription's (`@kuraykaraaslan-labs/tenant_subscription/testing`:
 * `checkPieceBundles`, `checkLegacyGrantContribution`).
 */

export interface PieceProblem {
  check: 'manifest' | 'declaration' | 'export';
  piece?: string;
  message: string;
}

interface ManifestContribution { point: string; key?: string; export?: string; metadata?: unknown }
interface Manifest {
  id?: string;
  dependencies?: { requires?: string[]; optional?: string[] };
  extensions?: ManifestContribution[];
}

/** The repository root (this file is `modules/feature_gate/server/testing/`). */
export const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');

const readJson = <T>(file: string): T | null => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as T : null);

/** JSON with object keys sorted, so two values compare whatever order their keys were written in. */
export const canonicalJson = (value: unknown): string => JSON.stringify(value, (_k, v: unknown) => (
  v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : v
));

/** A module's module.json, or null when the module is not in the tree. */
export function readModuleManifest(moduleId: string, root = REPO_ROOT): Manifest | null {
  return readJson<Manifest>(path.join(root, 'modules', moduleId, 'module.json'));
}

/** Every `feature_gate:pieces` contribution of the tree, as the registry would list them (module id, key, export, metadata). */
export function treePieceContributions(root = REPO_ROOT): Array<{ moduleId: string; key: string; export?: string; metadata?: unknown }> {
  const dir = path.join(root, 'modules');
  const out: Array<{ moduleId: string; key: string; export?: string; metadata?: unknown }> = [];
  for (const id of readdirSync(dir).sort()) {
    const m = readJson<Manifest>(path.join(dir, id, 'module.json'));
    for (const c of m?.extensions ?? []) {
      if (c.point === FEATURE_GATE_PIECES_POINT) out.push({ moduleId: id, key: c.key ?? '', export: c.export, metadata: c.metadata });
    }
  }
  return out;
}

/** The pieces a module declares in its module.json, parsed as the registry reads them (malformed ones left out). */
export function manifestPieces(moduleId: string, root = REPO_ROOT): DeclaredPiece[] {
  return treePieceContributions(root)
    .filter((c) => c.moduleId === moduleId)
    .map((c) => parsePieceContribution(c))
    .flatMap((r) => (r.ok ? [r.piece] : []));
}

/**
 * The declaration check: `declared` (the module's `definePieces(...)` list, its readable source) and its module.json contributions
 * to `feature_gate:pieces` are the same pieces in the same order with the same metadata; every contribution passes the point's
 * shape (ids, the zod metadata schema, derived keys the licence and the catalogue accept); the keys are the derived ones; the
 * contributions name one export, listed in the module's package.json; the module requires `feature_gate` (it calls the shared
 * piece check).
 */
export function checkPieceDeclarations(moduleId: string, declared: ReadonlyArray<DeclaredPiece>, options: { root?: string } = {}): PieceProblem[] {
  const root = options.root ?? REPO_ROOT;
  const problems: PieceProblem[] = [];
  const manifest = readModuleManifest(moduleId, root);
  if (!manifest) return [{ check: 'manifest', message: `modules/${moduleId}/module.json not found` }];
  if (!(manifest.dependencies?.requires ?? []).includes('feature_gate')) {
    problems.push({ check: 'manifest', message: `${moduleId} declares pieces but does not require feature_gate (the shared piece check)` });
  }
  const own = (manifest.extensions ?? []).filter((e) => e.point === FEATURE_GATE_PIECES_POINT);
  if (own.length === 0) problems.push({ check: 'manifest', message: `${moduleId} contributes nothing to ${FEATURE_GATE_PIECES_POINT}` });

  const seen = new Set<string>();
  for (const c of own) {
    const parsed = parsePieceContribution({ moduleId, key: c.key, metadata: c.metadata });
    if (!parsed.ok) problems.push({ check: 'manifest', piece: c.key, message: parsed.reason });
    if (c.key && seen.has(c.key)) problems.push({ check: 'manifest', piece: c.key, message: `piece '${c.key}' is contributed twice` });
    if (c.key) seen.add(c.key);
  }

  const exports = new Set(own.map((c) => c.export ?? ''));
  if (exports.size > 1) problems.push({ check: 'export', message: `the contributions name ${exports.size} exports; one declaration file holds every piece` });
  const pkg = readJson<{ exports?: Record<string, string> }>(path.join(root, 'modules', moduleId, 'package.json'));
  for (const exp of exports) {
    const sub = exp.startsWith(`${moduleId}/`) ? `./${exp.slice(moduleId.length + 1)}` : null;
    const target = sub ? pkg?.exports?.[sub] : undefined;
    if (!sub || !target) problems.push({ check: 'export', message: `export '${exp}' is not a package export of ${moduleId}` });
    else if (!existsSync(path.join(root, 'modules', moduleId, target))) problems.push({ check: 'export', message: `export '${exp}' points at ${target}, which does not exist` });
  }

  const manifestIds = own.map((c) => c.key ?? '');
  const declaredIds = declared.map((p) => p.id);
  if (JSON.stringify(manifestIds) !== JSON.stringify(declaredIds)) {
    problems.push({ check: 'declaration', message: `module.json declares [${manifestIds.join(', ')}], the declaration source [${declaredIds.join(', ')}]` });
  }
  for (const p of declared) {
    if (p.moduleId !== moduleId) problems.push({ check: 'declaration', piece: p.id, message: `declared under '${p.moduleId}', not '${moduleId}'` });
    if (p.key !== pieceFeatureKey(moduleId, p.id)) problems.push({ check: 'declaration', piece: p.id, message: `key ${p.key} is not the derived ${pieceFeatureKey(moduleId, p.id)}` });
    if (p.productKey !== pieceProductKey(moduleId, p.id)) problems.push({ check: 'declaration', piece: p.id, message: `product ${p.productKey} is not the derived ${pieceProductKey(moduleId, p.id)}` });
    const c = own.find((x) => x.key === p.id);
    const expected = { label: p.label, ...(p.description !== undefined ? { description: p.description } : {}) };
    if (c && canonicalJson(c.metadata ?? {}) !== canonicalJson(expected)) {
      problems.push({ check: 'declaration', piece: p.id, message: `module.json metadata ${JSON.stringify(c.metadata ?? {})} is not the declaration's ${JSON.stringify(expected)}` });
    }
  }
  return problems;
}
