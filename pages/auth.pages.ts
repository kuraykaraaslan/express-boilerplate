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
];

for (const p of pages) {
  router.get(at(p.page), (_req, res) => {
    res.render(p.view, { title: p.title, layout: 'layouts/blank' });
  });
}

export default router;
