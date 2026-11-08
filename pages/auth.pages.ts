import { Router } from 'express';

const router = Router();

// `/auth/<page>` in domain tenancy; `/tenant/{id}/auth/<page>` (and `/{prefix}/{id}/auth/<page>`) name the tenant explicitly.
const prefix = process.env.TENANT_PATH_PREFIX || 't';
const at = (page: string) => [
  `/auth/${page}`,
  `/tenant/:tenantId/auth/${page}`,
  `/${prefix}/:tenantId/auth/${page}`,
];

const pages: { page: string; view: string; title: string }[] = [
  { page: 'login', view: 'auth/login', title: 'Sign in' },
  { page: 'forgot-password', view: 'auth/forgot-password', title: 'Reset your password' },
  { page: 'reset-password', view: 'auth/reset-password', title: 'Set a new password' },
  { page: 'register', view: 'auth/register', title: 'Create an account' },
  { page: 'change-password', view: 'auth/change-password', title: 'Change your password' },
  { page: 'select-tenant', view: 'auth/select-tenant', title: 'Choose an organization' },
  { page: 'verify-email', view: 'auth/verify-email', title: 'Verify your email' },
  { page: 'logout', view: 'auth/logout', title: 'Signing out' },
  { page: 'callback', view: 'auth/callback', title: 'Completing sign in' },
  { page: 'complete-profile', view: 'auth/complete-profile', title: 'Finish setting up' },
  { page: 'onboarding', view: 'auth/onboarding', title: 'Open your organization' },
  { page: 'create-tenant', view: 'auth/create-tenant', title: 'Create an organization' },
];

for (const p of pages) {
  router.get(at(p.page), (_req, res) => {
    res.render(p.view, { title: p.title, layout: 'layouts/blank' });
  });
}

export default router;
