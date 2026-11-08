import { memberLabels } from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.read.service'
import { AppError } from '@kuraykaraaslan-labs/common/server/app-error'

/**
 * Who changed a board someone was customising (Discard's 409 and its status read), as the hub names a board's owner: the member's
 * e-mail, or null for a change that could not be attributed or a person who is no longer a member.
 */
export async function changedByLabel(tenantId: string, userId: string | null): Promise<string | null> {
  if (!userId) return null
  const labels = await memberLabels(tenantId, [userId]).catch(() => ({} as Record<string, string>))
  return labels[userId] ?? null
}

/** Discard's 409 with the name of whoever changed the board added to its details (`changedByLabel`). Any other error as it is. */
export async function withChangedByLabel(tenantId: string, e: unknown): Promise<unknown> {
  if (!(e instanceof AppError) || e.statusCode !== 409) return e
  const details = e.details
  if (!details || !('changedBy' in details)) return e
  details.changedByLabel = await changedByLabel(tenantId, (details.changedBy as string | null) ?? null)
  return e
}
