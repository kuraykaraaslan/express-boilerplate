import { createHash } from 'node:crypto';

/**
 * Merkle tree of the fleet attestations (docs/phases/02-fleet, Phase 5). Pure, no I/O.
 *
 * WIRE CONTRACT. Once a node has an acknowledged root, none of the rules below may change: a root is evidence that was signed over exactly
 * this construction. A change is a new `MERKLE_FORMAT_VERSION` (carried in every attested payload), never an edit. The golden vectors in
 * `tests/fleet_protocol.merkle.test.ts` freeze it.
 *
 * Tree: RFC 6962 section 2.1 (Certificate Transparency), SHA-256.
 *   leaf hash   = SHA-256(0x00 || leafData)
 *   node hash   = SHA-256(0x01 || left || right)
 *   empty tree  = SHA-256("")
 *   MTH(D[n])   = node(MTH(D[0:k]), MTH(D[k:n])) with k the largest power of two strictly below n. There is NO duplication of an odd
 *                 last node, so two different leaf lists never share a root (the duplicate-leaf ambiguity of the Bitcoin construction).
 * Inclusion proofs: RFC 6962 PATH(m, D[n]) and the verification algorithm of RFC 9162 section 2.1.3.2. Verification is strict: the path
 * must have exactly the length the tree shape demands, every element is a lower-case SHA-256 hex string.
 *
 * Leaves are typed (first byte), so a leaf of one kind can never be mistaken for a leaf of another kind even where the bytes would line up:
 *   AUDIT_HEAD  0x01 || tenantId (16 bytes of the uuid) || headHash (32) || rowCount (uint64 big endian)          = 57 bytes
 *   NODE_ROOT   0x02 || SHA-256(utf8 nodeId) (32) || merkleRoot (32) || periodEnd (uint64 big endian, epoch s)  = 73 bytes
 * Order: by the leaf's key bytes (type byte, then tenantId bytes / node id hash), ascending, byte-wise. Two leaves with the same key are an
 * error (a chain has one head, a node one latest root), never silently merged.
 *
 * `rowCount` is the number of rows the chain has ever held (rows since genesis, plus the rows an anchored checkpoint accounts for): it
 * only grows, so purging old rows never changes a leaf. The node's head reader is responsible for that definition; this file only encodes it.
 */
export const MERKLE_FORMAT_VERSION = 1;

export class MerkleError extends Error {
  constructor(public readonly code: 'BAD_LEAF' | 'DUPLICATE_LEAF' | 'BAD_HASH' | 'BAD_INDEX', message: string) {
    super(message);
    this.name = 'MerkleError';
  }
}

const HEX64 = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_PATH = 32;
const MAX_SIZE = 2 ** 31 - 1;

const sha = (...parts: Buffer[]): Buffer => createHash('sha256').update(Buffer.concat(parts)).digest();
const LEAF_PREFIX = Buffer.from([0x00]);
const NODE_PREFIX = Buffer.from([0x01]);

/** The root of a tree without leaves (RFC 6962: the hash of the empty string). */
export const EMPTY_ROOT = createHash('sha256').update('').digest('hex');

function hashBytes(hex: string): Buffer {
  if (!HEX64.test(hex)) throw new MerkleError('BAD_HASH', 'a hash must be 64 lower-case hex characters');
  return Buffer.from(hex, 'hex');
}

/** SHA-256(0x00 || data), hex. */
export function merkleLeafHash(data: Uint8Array): string {
  return sha(LEAF_PREFIX, Buffer.from(data)).toString('hex');
}

/** SHA-256(0x01 || left || right), hex. */
export function merkleNodeHash(left: string, right: string): string {
  return sha(NODE_PREFIX, hashBytes(left), hashBytes(right)).toString('hex');
}

// ── leaves ────────────────────────────────────────────────────────────────────

/** The head of one tenant's audit chain: its last row hash and how many rows the chain has ever held. */
export interface AuditHeadLeaf { type: 'AUDIT_HEAD'; tenantId: string; headHash: string; rowCount: number }
/** The latest verified audit root of one node, as the control plane committed to it. `periodEnd` is epoch seconds. */
export interface NodeRootLeaf { type: 'NODE_ROOT'; nodeId: string; merkleRoot: string; periodEnd: number }
export type MerkleLeaf = AuditHeadLeaf | NodeRootLeaf;

function u64(n: number, what: string): Buffer {
  if (!Number.isSafeInteger(n) || n < 0) throw new MerkleError('BAD_LEAF', `${what} must be a non-negative safe integer`);
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(n));
  return b;
}

/** The bytes of the leaf that identify it (everything before the value); leaves are ordered and de-duplicated by these. */
function leafKey(leaf: MerkleLeaf): Buffer {
  if (leaf.type === 'AUDIT_HEAD') {
    if (!UUID.test(leaf.tenantId)) throw new MerkleError('BAD_LEAF', 'tenantId must be a lower-case uuid');
    return Buffer.concat([Buffer.from([0x01]), Buffer.from(leaf.tenantId.replace(/-/g, ''), 'hex')]);
  }
  if (leaf.type === 'NODE_ROOT') {
    if (typeof leaf.nodeId !== 'string' || leaf.nodeId.length === 0 || leaf.nodeId.length > 64) throw new MerkleError('BAD_LEAF', 'nodeId must be 1-64 characters');
    return Buffer.concat([Buffer.from([0x02]), sha(Buffer.from(leaf.nodeId, 'utf8'))]);
  }
  throw new MerkleError('BAD_LEAF', 'unknown leaf type');
}

/** The leaf data that is hashed (`merkleLeafHash`). */
export function encodeLeaf(leaf: MerkleLeaf): Buffer {
  const key = leafKey(leaf);
  if (leaf.type === 'AUDIT_HEAD') return Buffer.concat([key, hashBytes(leaf.headHash), u64(leaf.rowCount, 'rowCount')]);
  return Buffer.concat([key, hashBytes(leaf.merkleRoot), u64(leaf.periodEnd, 'periodEnd')]);
}

/** The leaves in the one canonical order. The input is not modified. Throws on two leaves with the same key. */
export function orderLeaves<T extends MerkleLeaf>(leaves: readonly T[]): T[] {
  // encodeLeaf validates the value as well as the key: a malformed leaf fails here, not at hashing time
  const keyed = leaves.map((leaf) => { encodeLeaf(leaf); return { leaf, key: leafKey(leaf) }; });
  keyed.sort((a, b) => Buffer.compare(a.key, b.key));
  for (let i = 1; i < keyed.length; i++) {
    if (Buffer.compare(keyed[i - 1].key, keyed[i].key) === 0) throw new MerkleError('DUPLICATE_LEAF', 'two leaves share one key');
  }
  return keyed.map((k) => k.leaf);
}

// ── tree ──────────────────────────────────────────────────────────────────────

/** The largest power of two strictly below `n` (n >= 2). */
function largestPowerOfTwoBelow(n: number): number {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

/** MTH of already hashed leaves. */
export function merkleRoot(leafHashes: readonly string[]): string {
  for (const h of leafHashes) hashBytes(h);
  const walk = (lo: number, hi: number): string => {
    const n = hi - lo;
    if (n === 0) return EMPTY_ROOT;
    if (n === 1) return leafHashes[lo];
    const k = largestPowerOfTwoBelow(n);
    return merkleNodeHash(walk(lo, lo + k), walk(lo + k, hi));
  };
  return walk(0, leafHashes.length);
}

/** The inclusion proof of leaf `index` (RFC 6962 PATH): the sibling hashes from the leaf up to the root. */
export function inclusionPath(leafHashes: readonly string[], index: number): string[] {
  if (!Number.isInteger(index) || index < 0 || index >= leafHashes.length) throw new MerkleError('BAD_INDEX', 'index is outside the tree');
  for (const h of leafHashes) hashBytes(h);
  const walk = (lo: number, hi: number, m: number): string[] => {
    const n = hi - lo;
    if (n <= 1) return [];
    const k = largestPowerOfTwoBelow(n);
    if (m < k) return [...walk(lo, lo + k, m), merkleRoot(leafHashes.slice(lo + k, hi))];
    return [...walk(lo + k, hi, m - k), merkleRoot(leafHashes.slice(lo, lo + k))];
  };
  return walk(0, leafHashes.length, index);
}

export interface InclusionProof {
  /** Hash of the leaf (`merkleLeafHash(encodeLeaf(leaf))`). */
  leafHash: string;
  index: number;
  /** Number of leaves of the tree the root belongs to. */
  size: number;
  path: string[];
  root: string;
}

/**
 * True only when `path` is the inclusion proof of `leafHash` at `index` in a tree of `size` leaves with this `root` (RFC 9162 2.1.3.2).
 * Never throws: anything malformed is a failed proof.
 *
 * `size` is bound to the root only through the SHAPE of the tree: two sizes that give this leaf the same path length verify against the same
 * root. A caller that cares how many leaves the root covers compares `size` with the leaf count the root was attested with
 * (`tenantChainCount` of an AUDIT_CHAIN_ROOT payload).
 */
export function verifyInclusionProof(proof: InclusionProof): boolean {
  const { leafHash, index, size, path, root } = proof;
  if (!Number.isInteger(index) || !Number.isInteger(size) || index < 0 || size < 1 || size > MAX_SIZE || index >= size) return false;
  if (!Array.isArray(path) || path.length > MAX_PATH) return false;
  if (!HEX64.test(leafHash) || !HEX64.test(root) || path.some((p) => typeof p !== 'string' || !HEX64.test(p))) return false;
  let fn = index;
  let sn = size - 1;
  let r = leafHash;
  for (const p of path) {
    if (sn === 0) return false;
    if ((fn & 1) === 1 || fn === sn) {
      r = merkleNodeHash(p, r);
      if ((fn & 1) === 0) {
        while ((fn & 1) === 0 && fn !== 0) { fn >>= 1; sn >>= 1; }
      }
    } else {
      r = merkleNodeHash(r, p);
    }
    fn >>= 1;
    sn >>= 1;
  }
  return sn === 0 && r === root;
}

// ── typed trees ───────────────────────────────────────────────────────────────

export interface LeafTree<T extends MerkleLeaf> {
  /** The leaves in canonical order; `leafHashes[i]` belongs to `ordered[i]`. */
  ordered: T[];
  leafHashes: string[];
  root: string;
}

/** Orders the leaves, hashes them and computes the root. An empty list gives `EMPTY_ROOT`. */
export function buildLeafTree<T extends MerkleLeaf>(leaves: readonly T[]): LeafTree<T> {
  const ordered = orderLeaves(leaves);
  const leafHashes = ordered.map((l) => merkleLeafHash(encodeLeaf(l)));
  return { ordered, leafHashes, root: merkleRoot(leafHashes) };
}

/** The proof that `leaf` is in the tree built from `leaves`, or null when no leaf with its key is there. A leaf with the same key but another value is not a proof either: null. */
export function proveLeaf<T extends MerkleLeaf>(leaves: readonly T[], leaf: MerkleLeaf): InclusionProof | null {
  const tree = buildLeafTree(leaves);
  const wanted = encodeLeaf(leaf);
  const index = tree.ordered.findIndex((l) => encodeLeaf(l).equals(wanted));
  if (index < 0) return null;
  return { leafHash: tree.leafHashes[index], index, size: tree.ordered.length, path: inclusionPath(tree.leafHashes, index), root: tree.root };
}

/** True when `proof` proves exactly `leaf` (its encoding hashes to `proof.leafHash`) under `proof.root`. */
export function verifyLeafProof(leaf: MerkleLeaf, proof: InclusionProof): boolean {
  try {
    return merkleLeafHash(encodeLeaf(leaf)) === proof.leafHash && verifyInclusionProof(proof);
  } catch {
    return false;
  }
}
