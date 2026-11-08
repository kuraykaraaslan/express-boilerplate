/**
 * Message keys for the account surface.
 *
 * These three moved out of `auth.messages` with the routes that use them
 * (MIS-01). Their VALUES are unchanged, deliberately: the strings are what the
 * client matches on and what the i18n dictionaries key off, so renaming them
 * would have turned a module boundary fix into a visible behaviour change.
 */
enum AccountMessages {
  PROFILE_UPDATED_SUCCESSFULLY = 'PROFILE_UPDATED_SUCCESSFULLY',
  PREFERENCES_UPDATED_SUCCESSFULLY = 'PREFERENCES_UPDATED_SUCCESSFULLY',
  SECURITY_SETTINGS_RETRIEVED = 'SECURITY_SETTINGS_RETRIEVED',
}

export default AccountMessages
