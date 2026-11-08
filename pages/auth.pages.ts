import { Router } from 'express';

const router = Router();

// `/auth/login` in domain tenancy; `/tenant/{id}/auth/login` (and `/{prefix}/{id}/auth/login`) name the tenant explicitly.
const prefix = process.env.TENANT_PATH_PREFIX || 't';
const login = [
  '/auth/login',
  '/tenant/:tenantId/auth/login',
  `/${prefix}/:tenantId/auth/login`,
];

router.get(login, (req, res) => {
  res.render('auth/login', { title: 'Sign in', layout: 'layouts/blank' });
});

export default router;
