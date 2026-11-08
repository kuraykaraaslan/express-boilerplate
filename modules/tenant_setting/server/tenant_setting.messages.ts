const SettingMessages = {
  SETTING_NOT_FOUND: "Setting not found",
  SETTING_CREATED: "Setting created successfully",
  SETTING_UPDATED: "Setting updated successfully",
  SETTING_DELETED: "Setting deleted successfully",
  SETTINGS_UPDATED: "Settings updated successfully",
  INVALID_KEY: "Invalid setting key",
  INVALID_VALUE: "Invalid setting value",
  FETCH_FAILED: "Failed to fetch settings",
  UPDATE_FAILED: "Failed to update settings",
  DELETE_FAILED: "Failed to delete setting",
  MAKER_CHECKER_NO_REVIEWER: "Setting changes need a reviewer while maker-checker is on, and this workspace has none: turn the approval module on, or turn maker-checker off. Nothing was saved.",
} as const;

export default SettingMessages;
