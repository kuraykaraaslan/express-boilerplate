export enum UserSecurityMessages {
  SECURITY_RECORD_ALREADY_EXISTS = 'Security record already exists for this user',
  SECURITY_RECORD_NOT_FOUND = 'Security record not found',
  // Phase 55 00.6: a stable code (the account page and the platform user page translate it).
  TRUSTED_DEVICE_NOT_FOUND = 'TRUSTED_DEVICE_NOT_FOUND',
  // Phase 55 00.1: the security lock. The first is a stable code the sign-in pages translate (auth-error.ts), like ACCOUNT_LOCKED.
  ACCOUNT_SECURITY_LOCKED = 'ACCOUNT_SECURITY_LOCKED',
  // Phase 55 02.6: the sign-up hold (a security lock with the hold marker): the same stable code auth answers for an unverified address.
  EMAIL_VERIFICATION_REQUIRED = 'EMAIL_VERIFICATION_REQUIRED',
  SECURITY_LOCK_REASON_REQUIRED = 'A reason is required to lock an account.',
  SECURITY_LOCK_REASON_TOO_LONG = 'The reason is too long (500 characters at most).',
  SECURITY_LOCK_UNTIL_INVALID = 'The end of the lock must be a time in the future.',
  SECURITY_LOCK_SESSIONS_NOT_ENDED = 'The account is locked, but its active sessions could not all be ended. Try again.',
}

export default UserSecurityMessages;
