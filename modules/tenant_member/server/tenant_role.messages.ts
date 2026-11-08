export const TENANT_ROLE_MESSAGES = {
  ROLE_NOT_FOUND: 'Role not found',
  ROLE_KEY_TAKEN: 'A role with this key already exists',
  BUILTIN_IMMUTABLE: 'Built-in roles cannot be renamed or deleted',
  ROLE_IN_USE: 'This role is still assigned to members',
  OWNER_ONLY: 'Only owners can grant this permission or edit the owner role',
  UNKNOWN_PERMISSION: 'Unknown permission id',
  TEMPLATE_NOT_FOUND: 'Role template not found (or none of its modules is enabled)',
} as const;
