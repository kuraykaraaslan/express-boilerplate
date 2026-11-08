import { canonicalize } from './canonical';

/**
 * The bound co-sign challenge (decision F88, fleet audit FA-1), split out of `cosign.ts` so a browser can use it: nothing here imports `node:crypto`
 * or Node's `Buffer`. `cosign.ts` hashes these very texts with `node:crypto` (`commandHash`, `boundCosignChallenge`); the fleet console hashes them
 * with WebCrypto (`boundCosignChallengeWeb`), so the operator signs a value computed in the browser from what the screen shows (02-fleet/15 1.1).
 * A test pins both sides to the same hex.
 *
 * What a class-3 approval signs: sha256 over the canonical `{ d: 'fleet.cosign.v2', jti, aud, exp, body }`, where `jti` is the command id (lower
 * case), `aud` the envelope's audience (`node:<nodeId>`), `exp` the envelope's expiry (Unix seconds) and `body` the hex `commandHash` of the command
 * body without its approvals. So an approval counts for ONE command, on ONE node, inside ONE window: stored approvals cannot be replayed to another
 * node, as another command id or with a later expiry. The domain tag keeps it apart from every other hash an operator's key signs (the body hash
 * of the old scheme, a migration contract, a co-sign section, a registration challenge).
 */
export const COSIGN_CHALLENGE_DOMAIN = 'fleet.cosign.v2';

/** What a co-signature binds besides the body: the envelope's own `jti`, `aud` and `exp`. */
export interface CosignBinding { jti: string; aud: string; exp: number }

/** The canonical text of a command body as approvers sign it: the body WITHOUT `approvals` (the input of `commandHash`). */
export function commandBodyText(body: Record<string, unknown>): string {
  const { approvals: _approvals, ...rest } = body;
  void _approvals;
  return canonicalize(rest);
}

/** The canonical text whose sha256 is the bound challenge, for a body already hashed (`bodyHash` = `commandHash(body)`). Throws on a non-integer `exp`. */
export function boundCosignText(b: CosignBinding & { bodyHash: string }): string {
  return canonicalize({ d: COSIGN_CHALLENGE_DOMAIN, jti: b.jti.toLowerCase(), aud: b.aud, exp: b.exp, body: b.bodyHash });
}

const hex = (buf: ArrayBuffer): string => Array.from(new Uint8Array(buf), (x) => x.toString(16).padStart(2, '0')).join('');
const sha256Web = async (text: string, subtle: SubtleCrypto): Promise<string> => hex(await subtle.digest('SHA-256', new TextEncoder().encode(text)));

/** `commandHash` on WebCrypto: sha256 (hex) of `commandBodyText(body)`. */
export function commandHashWeb(body: Record<string, unknown>, subtle: SubtleCrypto = globalThis.crypto.subtle): Promise<string> {
  return sha256Web(commandBodyText(body), subtle);
}

/** `boundCosignChallenge` on WebCrypto: the same hex the control plane stores and the node recomputes from the envelope. */
export async function boundCosignChallengeWeb(i: CosignBinding & { body: Record<string, unknown> }, subtle: SubtleCrypto = globalThis.crypto.subtle): Promise<string> {
  return sha256Web(boundCosignText({ jti: i.jti, aud: i.aud, exp: i.exp, bodyHash: await commandHashWeb(i.body, subtle) }), subtle);
}
