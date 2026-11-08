const TenantMessages = {
  TENANT_NOT_FOUND: "Tenant not found",
  TENANT_NOT_PENDING_DELETION: "Tenant has no pending deletion to cancel",
  TENANT_ALREADY_EXISTS: "Tenant already exists",
  INVALID_TENANT_DATA: "Invalid tenant data",
  TENANT_ID_MISMATCH: "Tenant ID mismatch",
  MAINTENANCE_WINDOW_NOT_FOUND: "Maintenance window not found",
  MAINTENANCE_WINDOW_CLOSED: "Maintenance window is already completed or cancelled",
  MAINTENANCE_WINDOW_INVALID_TRANSITION: "Maintenance window cannot make this transition from its current status"
} as const;

export default TenantMessages;
