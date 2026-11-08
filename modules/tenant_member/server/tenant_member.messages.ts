const TenantMemberMessages = {
  ROLE_KEY_UNKNOWN: 'Unknown or inactive role group',
  MEMBER_NOT_FOUND: "Tenant member not found",
  INVALID_TENANT_ID: "Invalid tenant id",
  MEMBER_ALREADY_EXISTS: "User is already a member of this tenant",
  INVALID_MEMBER_DATA: "Invalid member data",
  CANNOT_REMOVE_OWNER: "Cannot remove the owner from the tenant",
  CANNOT_DEMOTE_OWNER: "Cannot demote the owner",
  LAST_OWNER: "Cannot remove the last owner of the tenant",
  NOT_SUSPENDED: "Only a suspended membership can be reactivated this way",
  INVALID_TRANSITION: "Unsupported member status transition",
  OWNER_MODIFY_FORBIDDEN: "Only owners can modify other owners",
  SENSITIVE_GROUP_OWNER_ONLY: "Only the workspace owner can assign or remove a group that holds a sensitive permission",
} as const;

export default TenantMemberMessages;
