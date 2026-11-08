const ApiKeyMessages = {
  NOT_FOUND: 'API key not found.',
  INVALID_KEY: 'Invalid or expired API key.',
  KEY_INACTIVE: 'API key is inactive.',
  KEY_EXPIRED: 'API key has expired.',
  INSUFFICIENT_SCOPE: 'API key does not have the required scope.',
  SCOPE_NOT_ALLOWED: "One or more requested scopes are not permitted by this tenant's plan.",
  NAME_REQUIRED: 'API key name is required.',
  SCOPE_REQUIRED: 'At least one scope must be selected.',
  CREATE_SUCCESS: 'API key created successfully.',
  DELETE_SUCCESS: 'API key revoked successfully.',
  UPDATE_SUCCESS: 'API key updated successfully.',
  ROTATE_SUCCESS: 'API key rotated successfully.',
  REVOKE_ALL_SUCCESS: 'All API keys for this tenant have been revoked.',
  FORBIDDEN: 'You do not have permission to manage API keys.',
  // Lifecycle / policy enforcement
  MAX_KEYS_REACHED: 'The maximum number of active API keys for this tenant has been reached.',
  TTL_EXCEEDS_MAX: 'The requested expiry exceeds the maximum key lifetime allowed for this tenant.',
  EXPIRY_REQUIRED: 'This tenant requires every API key to have an expiry date.',
  EXPIRY_IN_PAST: 'The expiry date must be in the future.',
  KEY_NOT_ROTATABLE: 'Only an active, unexpired key that has not been rotated yet can be rotated.',
  ROTATED_KEY_NOT_REACTIVATABLE: 'A rotated key cannot be reactivated; use its successor.',
  // Network / security
  IP_NOT_ALLOWED: 'This API key may not be used from the current IP address.',
  RATE_LIMITED: 'API key rate limit exceeded. Please slow down.',
  KEY_THROTTLED: 'API key throttled by a security decision; it is limited to a few calls a minute until the throttle ends.',
  VERIFY_UNAVAILABLE: 'The API key cannot be verified right now; try again shortly.',
  SERVICE_KEY_OWNER_ONLY: 'Only a workspace owner can mark or unmark a service key.',
  // Per-module permissions (phase 48)
  GRANT_REQUIRED: 'Select at least one module permission or integration scope.',
  PERMISSION_NOT_GRANTABLE: 'One or more permissions cannot be given to an API key, or their module is not enabled.',
  PERMISSION_NOT_HELD: 'An API key can only receive permissions you hold yourself.',
  NOT_WHILE_IMPERSONATING: 'An API key cannot be created while impersonating: it would outlive the impersonation as the member\'s own credential.',
  SCOPES_ONLY_NARROWED: "A key's integration scopes can only be narrowed; create a new key for wider ones.",
  INSUFFICIENT_PERMISSION: 'API key does not have the required permission.',
  // Scope-definition master data
  SCOPE_DEFINITION_NOT_FOUND: 'Scope definition not found.',
  SCOPE_DEFINITION_CREATE_FAILED: 'Failed to create scope definition.',
  SCOPE_DEFINITION_EXISTS: 'A scope definition with this scope already exists',
} as const;

export default ApiKeyMessages;
