import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import Logger from '@kuraykaraaslan-labs/logger';
import { resolveCeiling } from './feature_gate.ceiling';
import { FEATURE_GATE_MESSAGES } from './feature_gate.messages';
import { isMonetizationEnabled } from './feature_gate.monetization';
import type { DeclaredPiece } from './feature_gate.pieces';
import { piecesOf } from './feature_gate.pieces.registry';
import { checkFeatureAccess } from './feature_gate.service';

/**
 * The piece check (the standard of `feature_gate:pieces`, see `feature_gate.pieces.ts`): whether the pieces a module declares are
 * open for a tenant. One implementation for every module that sells pieces, so the rules cannot drift between them. A piece is open
 * when, in this order:
 *
 *  1. the deployment licence lets it be (the entitlement ceiling). No licence (`null`): nothing to say. A licence: only a piece whose
 *     key it names `true` may be open. That one reading covers the three rules: an explicit `false` closes the piece; when any key of
 *     the module's pieces is `true` only those are open; a licence that names none of the module's piece keys opens the module's
 *     core (its unsold part) only. "No licence" is the default `unrestricted` unlicensed policy, whose ceiling is `null`; under the
 *     `core` policy an unlicensed deployment answers the Core baseline, an empty ceiling that is not `null`, read as a deployment
 *     that bought no package: every piece is closed, for ROOT and with monetization off too. Fail closed, by design;
 *  2. the tenant is ROOT: open;
 *  3. monetization is off: open;
 *  4. otherwise `checkFeatureAccess(tenantId, key).allowed === true`.
 *
 * Any failure (the ceiling cannot answer, the gate or the switch throws, a piece asked about that the module does not declare) is a
 * 503: the check fails closed, a save it guards is refused, and nothing is shown as open that might not be. It never reads
 * `common/server/extensions/contributor-state.ts`, which fails open. Caching is the gate's own: the ceiling's process memo, the
 * switch's settings cache and the per-tenant entitlement cache; the switch and the licence are read once per call, the gate only
 * for the pieces the first rules leave open.
 *
 * This is the only reader of the ceiling for pieces: a module asks here and never imports `feature_gate.ceiling.ts`
 * (`tests/feature_gate.license-readers.architecture.test.ts`, owner rule S11 rule 8).
 */

export type PieceRule = 'licence' | 'root' | 'monetization_off' | 'entitlement';

export interface PieceState<Id extends string = string> {
  id: Id;
  /** The piece's entitlement key, `bundle:<moduleId>_<pieceId>`. */
  key: string;
  open: boolean;
  /** Which rule decided: `licence` (closed by the deployment licence) or the tenant rule that answered. */
  rule: PieceRule;
}

/** What the licence rule reads of the ceiling: a cap per key, or `null` when nothing caps anything. */
export type PieceCeiling = ReadonlyMap<string, { type: string; value: string }> | null;

/** `details.reason` of the 503 of a check that cannot answer. */
export const PIECE_CHECK_FAILED_REASON = 'piece_check_failed';

/** Rule 1: whether the deployment licence lets each piece be open at all (`true` = the tenant rules decide), by piece id. Pure. */
export function licenceAllowsPieces(ceiling: PieceCeiling, pieces: ReadonlyArray<Pick<DeclaredPiece, 'id' | 'key'>>): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const p of pieces) {
    if (ceiling === null) { out[p.id] = true; continue; }
    const cap = ceiling.get(p.key);
    out[p.id] = cap?.type === 'BOOLEAN' && cap.value === 'true';
  }
  return out;
}

/** The 503 of a check that cannot answer (a guard, a route and a seed read it as "closed"). */
export const pieceCheckUnavailable = (moduleId: string): AppError =>
  new AppError(FEATURE_GATE_MESSAGES.PIECE_CHECK_FAILED, 503, ErrorCode.INTERNAL_ERROR, { retryable: true, details: { reason: PIECE_CHECK_FAILED_REASON, moduleId } });

/** Whether an error is the 503 of a piece check that could not answer. */
export const isPieceCheckUnavailable = (err: unknown): err is AppError =>
  err instanceof AppError && err.statusCode === 503 && err.details?.reason === PIECE_CHECK_FAILED_REASON;

export interface PieceCheckOptions<Id extends string = string> {
  /**
   * The pieces to answer for, in the order to answer them. A piece the module does not declare is a 503. Default: every piece the
   * module declares, in the REGISTRY's order (each contribution's module.json `order`, default 100, then its id, which within one
   * module is the piece id), not the order of the module's `definePieces` list. Pass `only` (or set `order` on the module.json
   * entries) when the order matters.
   */
  only?: readonly Id[];
  /** `false` for a read that only shows the states (a route, a seed); a guard decision keeps the gate's own `feature.access.checked` row. */
  audit?: boolean;
}

/** The state of a module's pieces for a tenant (see the file comment). Throws 503 when that cannot be answered. */
export async function pieceStates<Id extends string = string>(
  tenantId: string,
  moduleId: string,
  options: PieceCheckOptions<Id> = {},
): Promise<Array<PieceState<Id>>> {
  if (options.only && options.only.length === 0) return [];
  try {
    const declared = await piecesOf(moduleId);
    const byId = new Map(declared.map((p) => [p.id, p]));
    const ids = options.only ? [...new Set(options.only)] : declared.map((p) => p.id as Id);
    const pieces = ids.map((id) => {
      const piece = byId.get(id);
      if (!piece) throw new Error(`piece '${id}' is not declared by ${moduleId} (feature_gate:pieces)`);
      return piece;
    });
    if (pieces.length === 0) return [];
    const licence = licenceAllowsPieces(await resolveCeiling(), pieces);
    const states: Array<PieceState<Id>> = [];
    let tenantRule: 'root' | 'monetization_off' | null | undefined;
    for (const p of pieces) {
      const id = p.id as Id;
      if (!licence[p.id]) { states.push({ id, key: p.key, open: false, rule: 'licence' }); continue; }
      if (tenantRule === undefined) {
        tenantRule = isRootTenant(tenantId) ? 'root' : (await isMonetizationEnabled()) ? null : 'monetization_off';
      }
      if (tenantRule) { states.push({ id, key: p.key, open: true, rule: tenantRule }); continue; }
      const access = await checkFeatureAccess(tenantId, p.key, undefined, options.audit === false ? { audit: false } : undefined);
      states.push({ id, key: p.key, open: access.allowed === true, rule: 'entitlement' });
    }
    return states;
  } catch (err) {
    Logger.error(`[feature_gate] piece check of ${moduleId} failed: ${err instanceof Error ? err.message : String(err)}`);
    throw pieceCheckUnavailable(moduleId);
  }
}

/** Whether one piece of a module is open for a tenant. Throws 503 when that cannot be answered. */
export async function isPieceOpen(tenantId: string, moduleId: string, pieceId: string): Promise<boolean> {
  const [state] = await pieceStates(tenantId, moduleId, { only: [pieceId] });
  return state?.open === true;
}

/** The ids of a module's pieces open for a tenant. Throws 503 when that cannot be answered. */
export async function openPieces<Id extends string = string>(tenantId: string, moduleId: string, options: PieceCheckOptions<Id> = {}): Promise<Set<Id>> {
  return new Set((await pieceStates(tenantId, moduleId, options)).filter((s) => s.open).map((s) => s.id));
}
