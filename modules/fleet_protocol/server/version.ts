/** Protocol versions this build speaks (docs/phases/02-fleet/03 §2, §5). */
export const PROTOCOL_VERSIONS: readonly number[] = [1];

/** Highest version both sides speak, or null when there is no overlap. */
export function negotiateVersion(
  theirs: readonly number[],
  ours: readonly number[] = PROTOCOL_VERSIONS,
): number | null {
  const common = ours.filter((v) => theirs.includes(v));
  return common.length ? Math.max(...common) : null;
}
