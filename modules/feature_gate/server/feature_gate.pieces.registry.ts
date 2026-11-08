import Logger from '@kuraykaraaslan-labs/logger';
import { ext, systemCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext';
import { FEATURE_GATE_PIECES_POINT, parsePieceContribution, pieceOwners, type DeclaredPiece, type PieceOwners } from './feature_gate.pieces';

/**
 * The pieces every installed module declares (`feature_gate:pieces`, see `feature_gate.pieces.ts`), read from the contributions'
 * static metadata only (no code is loaded) in a system context: the declarations of this build, whatever a tenant switched on.
 * Each contribution is checked against the point's shape (`parsePieceContribution`: ids, the zod metadata schema, derived keys the
 * licence and the catalogue accept); a malformed one, or a second declaration of the same piece, is dropped with a warning, so a
 * piece the check is asked about but that is not declared here cannot be answered (the check fails closed, 503).
 *
 * Resolved once per process (the declarations change only with a build); a failed read is retried on the next call.
 */

let cache: Promise<ReadonlyMap<string, readonly DeclaredPiece[]>> | null = null;

async function build(): Promise<ReadonlyMap<string, readonly DeclaredPiece[]>> {
  const out = new Map<string, DeclaredPiece[]>();
  for (const c of await ext.contributions(FEATURE_GATE_PIECES_POINT, systemCtx('feature_gate piece declarations'))) {
    const parsed = parsePieceContribution({ moduleId: c.moduleId, key: c.key, metadata: c.metadata });
    if (!parsed.ok) {
      Logger.warn(`[feature_gate] ignoring a malformed piece declaration of '${c.moduleId}': ${parsed.reason}`);
      continue;
    }
    const list = out.get(c.moduleId) ?? [];
    if (list.some((p) => p.id === parsed.piece.id)) {
      Logger.warn(`[feature_gate] piece '${parsed.piece.id}' of '${c.moduleId}' is declared twice; the first one is kept`);
      continue;
    }
    list.push(parsed.piece);
    out.set(c.moduleId, list);
  }
  return out;
}

/** Every declared piece of this build, by module id. */
export function declaredPieces(): Promise<ReadonlyMap<string, readonly DeclaredPiece[]>> {
  cache ??= build().catch((error: unknown) => { cache = null; throw error; });
  return cache;
}

/**
 * The pieces one module declares ([] for a module that declares none, or is not installed), in the registry's order: each
 * contribution's module.json `order` (default 100), then its id, which within one module is the piece id. Not the order the
 * module wrote its entries or its `definePieces` list in: the generated registry keeps no position.
 */
export async function piecesOf(moduleId: string): Promise<readonly DeclaredPiece[]> {
  return (await declaredPieces()).get(moduleId) ?? [];
}

/**
 * Who declares each piece key of this build (`pieceOwners` over every declaration): what the catalogue merge and the legacy grants
 * sweep of tenant_subscription read, so a module never sells or comps another module's piece.
 */
export async function declaredPieceOwners(): Promise<PieceOwners> {
  return pieceOwners([...(await declaredPieces()).values()].flat());
}

/** Forget the resolved declarations. For tests. */
export function resetDeclaredPieces(): void {
  cache = null;
}
