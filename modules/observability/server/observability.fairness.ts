/**
 * Noisy-neighbour fairness (observability phase 16.4, reused by the probe-runner lease in phase 10): lists are taken ONE item per tenant per round,
 * so when a ceiling truncates, it truncates everyone a little instead of starving whoever is last. A tenant with 5 000 monitors cannot push a
 * tenant with 5 out. A leaf module: the probe job (which creates a queue on import) and the lease service both read it.
 */
export function interleave<T>(lists: T[][]): T[] {
  const out: T[] = []
  for (let i = 0; lists.some((l) => i < l.length); i += 1) for (const l of lists) if (i < l.length) out.push(l[i])
  return out
}
