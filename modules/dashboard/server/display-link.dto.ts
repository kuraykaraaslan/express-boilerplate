import { z } from 'zod'
import { DEFAULT_TTL_DAYS, MAX_TTL_DAYS } from './display-token'
import type { DashboardDisplayLink } from './entities/dashboard_display_link.entity'

/** POST …/boards/[boardId]/display-links: a name for the screen and how long the link lives. Nothing else. */
export const CreateDisplayLinkDTO = z
  .object({
    label: z.string().trim().min(1).max(80),
    expiresInDays: z.number().int().min(1).max(MAX_TTL_DAYS).default(DEFAULT_TTL_DAYS),
  })
  .strict()
export type CreateDisplayLinkInput = z.infer<typeof CreateDisplayLinkDTO>

export type DisplayLinkStatus = 'active' | 'expired' | 'revoked'

/**
 * What a management response says about a link. Never the hash, never the token: the token is only in the one POST
 * response that created it. `issuerEligible` is set by the list route (whether the issuer would still pass the
 * display principal's checks), so an admin sees why a screen stopped.
 */
export type DisplayLinkView = {
  displayLinkId: string
  label: string
  tokenHint: string
  createdByUserId: string
  createdAt: string
  expiresAt: string
  revokedAt: string | null
  lastUsedAt: string | null
  status: DisplayLinkStatus
  issuerEligible?: boolean
}

const iso = (d: Date | string | null | undefined): string | null => (d ? new Date(d).toISOString() : null)

export function displayLinkStatus(row: Pick<DashboardDisplayLink, 'revokedAt' | 'expiresAt'>, now: Date = new Date()): DisplayLinkStatus {
  if (row.revokedAt) return 'revoked'
  return new Date(row.expiresAt).getTime() <= now.getTime() ? 'expired' : 'active'
}

export function toDisplayLinkView(row: DashboardDisplayLink, now: Date = new Date()): DisplayLinkView {
  return {
    displayLinkId: row.displayLinkId,
    label: row.label,
    tokenHint: row.tokenHint,
    createdByUserId: row.createdByUserId,
    createdAt: iso(row.createdAt)!,
    expiresAt: iso(row.expiresAt)!,
    revokedAt: iso(row.revokedAt),
    lastUsedAt: iso(row.lastUsedAt),
    status: displayLinkStatus(row, now),
  }
}
