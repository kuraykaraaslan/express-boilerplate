#!/usr/bin/env node
// Copies the kui-ejs view layer over kui/ (replacing it): the partials (modules/ui, modules/app, modules/domain/common), the layouts and
// shared partials, the stylesheet sources, fonts and favicons. The showcase itself (themes, registry, demo data) stays in kui-ejs.
// The folder layout is kept (kui/modules next to kui/views) because the partials include each other by relative path.
// Usage: node scripts/sync-kui-ejs.mjs [path-to-kui-ejs]
import fs from 'node:fs';
import path from 'node:path';

const src = path.resolve(process.argv[2] ?? '../kui-ejs');
const dst = path.resolve(import.meta.dirname, '..', 'kui');
const parts = [
  'modules/ui', 'modules/app', 'modules/domain/common',
  'views/layouts', 'views/partials', 'views/404.ejs',
  'public/assets/css/input.css', 'public/assets/js/main.js', 'public/assets/css/fontawesome.css', 'public/assets/fonts',
  'public/favicon.ico', 'public/favicon.png', 'public/favicon.svg',
];
fs.rmSync(dst, { recursive: true, force: true });
for (const p of parts) {
  const from = path.join(src, p);
  if (!fs.existsSync(from)) { console.warn('missing', p); continue; }
  fs.mkdirSync(path.dirname(path.join(dst, p)), { recursive: true });
  fs.cpSync(from, path.join(dst, p), { recursive: true });
}
fs.writeFileSync(path.join(dst, 'README.md'), '# kui\n\nVendored from kui-ejs by `scripts/sync-kui-ejs.mjs`. Do not edit here: change kui-react first, then kui-ejs, then re-sync.\n');
console.log('synced kui-ejs ->', dst);
