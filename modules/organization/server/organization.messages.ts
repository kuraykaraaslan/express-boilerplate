export const ORGANIZATION_MESSAGES = {
  GL_ACCOUNT_INVALID: 'The GL account does not exist in this workspace\'s ledger',
  LEGAL_ENTITY_DEFAULT_REQUIRED: 'A tenant always has a default legal entity; promote another one instead',
  LOGO_KEY_INVALID: 'The logo must be an https URL or a storage key of this workspace',
  LEGAL_ENTITY_NOT_FOUND: 'Legal entity not found',
  SITE_NOT_FOUND: 'Site not found',
  COST_CENTER_NOT_FOUND: 'Cost center not found',

  LEGAL_ENTITY_CREATE_FAILED: 'Failed to create legal entity',
  SITE_CREATE_FAILED: 'Failed to create site',
  COST_CENTER_CREATE_FAILED: 'Failed to create cost center',

  CODE_TAKEN: 'Another record in this tenant already uses this code',
  CODE_GENERATION_FAILED: 'Could not allocate a free code, please supply one explicitly',

  PARENT_NOT_FOUND: 'Parent cost center not found',
  PARENT_CYCLE: 'A cost center cannot be its own ancestor',
  COST_CENTER_HAS_CHILDREN: 'Cannot delete a cost center that still has child cost centers',

  LEGAL_ENTITY_NOT_SET: 'This tenant has no default legal entity yet',
  DEFAULT_LEGAL_ENTITY_UNDELETABLE:
    'Cannot delete the default legal entity; promote another one first',
  LEGAL_ENTITY_UNKNOWN: 'The referenced legal entity does not exist in this tenant',
  TEAM_NOT_FOUND: 'Team not found',
  TEAM_CODE_TAKEN: 'A team with this code already exists',
  /** Both self-parenting and descendant-parenting make a path unreachable. */
  TEAM_CYCLE: 'A team cannot be placed inside itself or one of its own subteams',
  TEAM_HAS_MEMBERS: 'This team still has active members — move them first',
  TEAM_HAS_CHILDREN: 'This team still has subteams — move or remove them first',
  TEAM_MEMBER_NOT_FOUND: 'That user is not an active member of this team',
} as const

/**
 * 409 body for a delete blocked by `organization:reference_check`. Built here
 * rather than interpolated at the throw site so the wording stays in one place,
 * and spelled out per-field so no verb is ever injected into a sentence.
 */
export function stillReferencedMessage(moduleId: string, count: number, label: string): string {
  return `Cannot delete: ${count} ${label} in module "${moduleId}" still reference this record`
}

/**
 * 409 body for a delete refused because a holder of referencing rows could not
 * be asked (it threw or timed out). EXT-3: a reference check that cannot answer
 * blocks the delete. Names the module(s), never the underlying error.
 */
export function referenceUnverifiableMessage(moduleIds: string[]): string {
  const names = moduleIds.map((id) => `"${id}"`).join(', ')
  return `Cannot delete: could not verify ${moduleIds.length === 1 ? 'module' : 'modules'} ${names}, which may still reference this record. Try again later`
}
