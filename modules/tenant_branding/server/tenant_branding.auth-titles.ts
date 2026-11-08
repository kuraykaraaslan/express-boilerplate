/** Browser-tab titles of the auth pages, by their first path segment after /auth (the app name is appended). */
const AUTH_TITLES: Record<string, string> = {
  login: 'Sign in',
  register: 'Sign up',
  'select-tenant': 'Organizations',
  onboarding: 'Open your organization',
  'create-tenant': 'Create organization',
  'forgot-password': 'Forgot password',
  'reset-password': 'Reset password',
  'verify-email': 'Verify email',
  'complete-profile': 'Complete your profile',
  callback: 'Signing in',
  logout: 'Sign out',
};

export function authPageTitle(segment: string | undefined): string {
  // Own keys only: an Object.prototype member (/auth/constructor) is an unknown segment, not a title.
  return (segment && Object.hasOwn(AUTH_TITLES, segment) && AUTH_TITLES[segment]) || 'Sign in';
}
