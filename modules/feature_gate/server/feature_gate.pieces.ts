import { z } from 'zod';

/**
 * Sellable pieces inside a module: the declaration (the `feature_gate:pieces` point) and the key convention every module that sells
 * part of itself uses. Pure, with no server-only import and no other feature_gate file, so a client page and a script read the same
 * rules.
 *
 * A piece is an entitlement KEY, not a module: it opens a fixed part of a module that the module itself decides (a set of symbols, a
 * library of 3D items). The module's code ships whole; the key decides who may add the piece's content. A module declares its pieces
 * through `feature_gate:pieces`, one contribution per piece under its own module id, the contribution key being the piece id and the
 * static metadata `{ label, description? }` (English). The keys are DERIVED, never written by hand:
 *
 *   - entitlement key `bundle:<moduleId>_<pieceId>` (what a licence names, what a catalogue product grants, what the gate checks);
 *   - catalogue product `bundle_<moduleId>_<pieceId>` (the one-time, feature-only add-on that sells the piece on its own).
 *
 * A piece id has no underscore, so a derived key reads back one way (`bundle:dashboard_scada_home` is the piece `home` of
 * `dashboard_scada`, never a piece `scada_home` of a module `dashboard`). The derived keys must pass the licence allowlist
 * (`isCappableKey` / `capOf` of fleet_license, a `bundle:<key>` BOOLEAN) and the catalogue's contributed bundle key, so the patterns
 * below repeat theirs; `tests/feature_gate.pieces.test.ts` pins them to both.
 *
 * The shared piece check is `feature_gate.piece-check.ts`; the registry reader of the declarations is `feature_gate.pieces.registry.ts`.
 */

/** Extension point id, declared in feature_gate/module.json `extensionPoints`. */
export const FEATURE_GATE_PIECES_POINT = 'feature_gate:pieces';

/** A module id (module.schema.json `id`). */
export const PIECE_MODULE_ID = /^[a-z][a-z0-9_]*$/;

/** A piece id: a lower-case letter, then letters and digits, no underscore (see above), at most 24 characters. */
export const PIECE_ID = /^[a-z][a-z0-9]{0,23}$/;

/** The licence allowlist's shape of a bundle key (fleet_license `license.feature-ceiling.ts`, `MODULE_OR_BUNDLE_KEY`). */
export const PIECE_FEATURE_KEY = /^bundle:[a-z][a-z0-9_]{0,63}$/;

/** The catalogue's shape of a contributed bundle key (tenant_subscription `catalog-bundles.ts`, `BUNDLE_KEY`). */
export const PIECE_PRODUCT_KEY = /^bundle_[a-z0-9_]{1,60}$/;

export type PieceFeatureKey<M extends string = string, P extends string = string> = `bundle:${M}_${P}`;
export type PieceProductKey<M extends string = string, P extends string = string> = `bundle_${M}_${P}`;

/** The entitlement key of a piece: `bundle:<moduleId>_<pieceId>` (the `bundleFeatureKey` of `<moduleId>_<pieceId>`). */
export const pieceFeatureKey = <M extends string, P extends string>(moduleId: M, pieceId: P): PieceFeatureKey<M, P> =>
  `bundle:${moduleId}_${pieceId}`;

/** The catalogue product that sells a piece on its own: `bundle_<moduleId>_<pieceId>`. */
export const pieceProductKey = <M extends string, P extends string>(moduleId: M, pieceId: P): PieceProductKey<M, P> =>
  `bundle_${moduleId}_${pieceId}`;

/** The static metadata of one `feature_gate:pieces` contribution. */
export const PieceDeclarationSchema = z.object({
  /** The piece's English name (a store link "Get <label>", a refusal, a licence listing); screens translate it themselves. */
  label: z.string().min(1).max(80),
  /** One English sentence on what the piece opens. */
  description: z.string().min(1).max(500).optional(),
}).strict();
export type PieceDeclaration = z.infer<typeof PieceDeclarationSchema>;

/** One declared piece with its derived keys. */
export interface DeclaredPiece<M extends string = string, P extends string = string> {
  moduleId: M;
  id: P;
  label: string;
  description?: string;
  /** `bundle:<moduleId>_<pieceId>`. */
  key: PieceFeatureKey<M, P>;
  /** `bundle_<moduleId>_<pieceId>`. */
  productKey: PieceProductKey<M, P>;
}

export type PieceParse = { ok: true; piece: DeclaredPiece } | { ok: false; reason: string };

/**
 * One contribution as a declared piece, or why it is refused: a module id or piece id outside the patterns, metadata outside
 * {@link PieceDeclarationSchema}, or derived keys the licence allowlist or the catalogue would refuse (too long).
 */
export function parsePieceContribution(c: { moduleId: string; key?: string | null; metadata?: unknown }): PieceParse {
  if (typeof c.moduleId !== 'string' || !PIECE_MODULE_ID.test(c.moduleId)) return { ok: false, reason: `module id '${String(c.moduleId)}' is not a module id` };
  const id = c.key ?? '';
  if (!PIECE_ID.test(id)) return { ok: false, reason: `piece id '${id}' must be a lower-case letter then letters or digits (no underscore), at most 24` };
  const meta = PieceDeclarationSchema.safeParse(c.metadata ?? {});
  if (!meta.success) return { ok: false, reason: `piece '${id}': ${meta.error.issues[0]?.path.join('.') || 'metadata'}: ${meta.error.issues[0]?.message}` };
  const key = pieceFeatureKey(c.moduleId, id);
  if (!PIECE_FEATURE_KEY.test(key)) return { ok: false, reason: `piece '${id}': its key ${key} is longer than a licence key may be` };
  const productKey = pieceProductKey(c.moduleId, id);
  if (!PIECE_PRODUCT_KEY.test(productKey)) return { ok: false, reason: `piece '${id}': its product ${productKey} is longer than a catalogue key may be` };
  return {
    ok: true,
    piece: { moduleId: c.moduleId, id, label: meta.data.label, ...(meta.data.description ? { description: meta.data.description } : {}), key, productKey },
  };
}

/** What a module writes for each piece in its declaration source (the keys are derived). */
export interface PieceInput {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
}

/**
 * A module's piece list, with the derived keys, from its declaration source (`<module>.piece-list.ts`, the readable twin of its
 * module.json `feature_gate:pieces` contributions; the module's test pins the two with `checkPieceDeclarations` of
 * `@kuraykaraaslan-labs/feature_gate/testing`). Throws on a piece the point would refuse and on a repeated id, so a wrong
 * declaration fails at import, in its first test.
 */
export function definePieces<const M extends string, const L extends readonly PieceInput[]>(
  moduleId: M,
  pieces: L,
): ReadonlyArray<DeclaredPiece<M, L[number]['id']>> {
  const seen = new Set<string>();
  const out = pieces.map((p) => {
    const parsed = parsePieceContribution({ moduleId, key: p.id, metadata: { label: p.label, ...(p.description !== undefined ? { description: p.description } : {}) } });
    if (!parsed.ok) throw new Error(`[feature_gate:pieces] ${moduleId}: ${parsed.reason}`);
    if (seen.has(p.id)) throw new Error(`[feature_gate:pieces] ${moduleId}: piece '${p.id}' is declared twice`);
    seen.add(p.id);
    return Object.freeze(parsed.piece) as DeclaredPiece<M, L[number]['id']>;
  });
  return Object.freeze(out);
}

/** The piece ids of a declaration, as a union type. */
export type PieceIdOf<T extends ReadonlyArray<{ id: string }>> = T[number]['id'];

/** Piece key (`bundle:<moduleId>_<pieceId>`) -> the module that declares it. */
export type PieceOwners = ReadonlyMap<string, string>;

/** Who declares each piece key, over a set of declared pieces (every module's, to judge a module against the others). Pure. */
export function pieceOwners(pieces: Iterable<Pick<DeclaredPiece, 'moduleId' | 'key'>>): PieceOwners {
  const out = new Map<string, string>();
  for (const p of pieces) if (!out.has(p.key)) out.set(p.key, p.moduleId);
  return out;
}

/**
 * The keys among `keys` that are pieces another module declares: what `moduleId` may never sell or comp (a module sells and
 * grandfathers only its own pieces). Exact keys only, so `bundle:a_b_c` of a module `a_b` is never read as `a`'s. Pure.
 */
export function foreignPieceKeys(moduleId: string, keys: Iterable<string>, owners: PieceOwners): string[] {
  const out: string[] = [];
  for (const k of keys) {
    const owner = owners.get(k);
    if (owner !== undefined && owner !== moduleId && !out.includes(k)) out.push(k);
  }
  return out;
}

/**
 * Whether `key` is in the piece key namespace of `moduleId` (`bundle:<moduleId>_<anything>`): for a module that declares pieces, a
 * key a licence may name only when it is a declared piece (of that module, or of a module whose id extends it). Pure.
 */
export function inPieceNamespace(moduleId: string, key: string): boolean {
  const prefix = `bundle:${moduleId}_`;
  return key.length > prefix.length && key.startsWith(prefix);
}
