#!/usr/bin/env node
// Copies the edition:"core" modules of next-boilerplate over modules/<id> (replacing the old folder).
// Copied: module.json, package.json, README.md, dictionaries/, server/ (tests excluded). Pages (ui/) stay in NB;
// Express pages are EJS and are built separately. Usage: node scripts/sync-core-from-nb.mjs [path-to-nb]
import fs from 'node:fs';
import path from 'node:path';

const nb = path.resolve(process.argv[2] ?? '../next-boilerplate');
const here = path.resolve(import.meta.dirname, '..');
const skip = (p) => /(^|\/)tests?(\/|$)/.test(p) || /\.(test|spec)\.[tj]sx?$/.test(p);

function copyDir(from, to) {
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name);
    const rel = path.relative(nb, s);
    if (skip(rel)) continue;
    const d = path.join(to, e.name);
    if (e.isDirectory()) { fs.mkdirSync(d, { recursive: true }); copyDir(s, d); }
    else fs.copyFileSync(s, d);
  }
}

const ids = fs.readdirSync(path.join(nb, 'modules')).filter((id) => {
  const f = path.join(nb, 'modules', id, 'module.json');
  return fs.existsSync(f) && JSON.parse(fs.readFileSync(f, 'utf8')).edition === 'core';
});
for (const id of ids) {
  const src = path.join(nb, 'modules', id), dst = path.join(here, 'modules', id);
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(dst, { recursive: true });
  for (const f of ['module.json', 'package.json', 'README.md']) if (fs.existsSync(path.join(src, f))) fs.copyFileSync(path.join(src, f), path.join(dst, f));
  for (const d of ['dictionaries', 'server', 'contract']) if (fs.existsSync(path.join(src, d))) { fs.mkdirSync(path.join(dst, d), { recursive: true }); copyDir(path.join(src, d), path.join(dst, d)); }
  console.log('synced', id);
}
console.log(ids.length, 'core modules');
