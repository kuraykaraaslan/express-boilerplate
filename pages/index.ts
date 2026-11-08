// Server-rendered pages (EJS, vendored kui-ejs partials in kui/). Mounted after the module API; the pages call that API from the browser.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';
import expressLayouts from 'express-ejs-layouts';
import helmet from 'helmet';
import authPages from './auth.pages';
import adminPages from './admin.pages';
import { tenantOfHost } from '../router/dispatch';
import { hostWithoutPort } from '@kuraykaraaslan-labs/common/server/tenant-host';

const root = path.resolve(__dirname, '..');

export function mountPages(app: Express): void {
  app.set('view engine', 'ejs');
  app.set('views', [path.join(root, 'views'), path.join(root, 'kui/views')]);
  app.locals.site = {
    name: process.env.SITE_NAME ?? 'App', title: process.env.SITE_NAME ?? 'App', description: process.env.SITE_DESCRIPTION ?? '',
    keywords: '', author: '', authorUrl: '', url: process.env.SITE_URL ?? '', googleTag: '', twitterHandle: '',
  };
  app.locals.colorOverrideCss = '';
  try {
    app.locals.assetVersion = crypto.createHash('md5').update(fs.readFileSync(path.join(root, 'public/assets/css/app.css'))).digest('hex').slice(0, 8);
  } catch { app.locals.assetVersion = 'dev'; }

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(expressLayouts);
  app.set('layout', 'layouts/blank');
  app.use(express.static(path.join(root, 'public')));
  app.use(express.static(path.join(root, 'kui/public')));
  const tenancy = { mode: process.env.TENANCY_MODE === 'path' ? 'path' : 'domain', prefix: process.env.TENANT_PATH_PREFIX || 't' };
  // The browser's tenantPath() reads this before any script runs (NB's <TenancyScript/>).
  app.locals.tenancyHead = `<script>window.__TENANCY__=${JSON.stringify(tenancy)};</script>`;
  app.use(async (req, res, next) => {
    res.locals.extraHead = app.locals.tenancyHead;
    // The tenant this page is for: explicit in the path, else the host's (domain tenancy).
    const tenantPrefix = (process.env.TENANT_PATH_PREFIX || 't').replace(/[^A-Za-z0-9_-]/g, '');
    const explicit = req.path.match(new RegExp(`^/(?:tenant|${tenantPrefix})/([^/]+)`))?.[1];
    res.locals.tenantId = explicit ?? (await tenantOfHost(hostWithoutPort(req.headers.host ?? ''))) ?? '';
    res.locals.currentPath = req.path;
    res.locals.theme = req.headers.cookie?.includes('theme=dark') ? 'dark' : 'light';
    res.locals.runtimeOnce = {};
    next();
  });

  app.use(authPages);
  app.use(adminPages);
  app.use((_req, res) => { res.status(404).render('404', { title: 'Not found' }); });
}
