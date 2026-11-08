#!/usr/bin/env node
// Copies the edition:"core" modules of next-boilerplate over modules/<id> (replacing the old folder).
// Copied: module.json, README.md (no package.json: Express resolves @kuraykaraaslan-labs/<id> through tsconfig paths), dictionaries/, server/ (tests excluded). Pages (ui/) stay in NB;
// Express pages are EJS and are built separately.
//
// Usage: node scripts/sync-core-from-nb.mjs [path-to-nb] [--generated <dir>]
//
// The git-ignored generated registry (modules/{common,db}/server/generated) lists every module of the tree it was built in, so it is
// built for Core only, in a scratch copy, never in NB:
//   node scripts/edition/export.mjs --edition enterprise --packages iot --out <tmp> --ref HEAD     (in NB)
//   in <tmp>: ln -s <nb>/node_modules node_modules; in scripts/build-registry-snapshot.mjs pass `new Set()` instead of PROTECTED to
//   resolveDisabledModules; NB_DISABLED_MODULES=<every non-core id> node scripts/build-registry-snapshot.mjs --force
// then pass <tmp> as --generated: its modules/common/server/generated and modules/db/server/generated are copied over.
import fs from 'node:fs';
import path from 'node:path';

const nb = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '../next-boilerplate');
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
  for (const f of ['module.json', 'README.md']) if (fs.existsSync(path.join(src, f))) fs.copyFileSync(path.join(src, f), path.join(dst, f));
  for (const d of ['dictionaries', 'server', 'contract', 'data', 'models', 'schema', 'vendor', 'sdk', 'runner']) if (fs.existsSync(path.join(src, d))) { fs.mkdirSync(path.join(dst, d), { recursive: true }); copyDir(path.join(src, d), path.join(dst, d)); }
  console.log('synced', id);
}
// Some server files import a file out of a module's ui/ (shell_menu -> app_shell/ui/shell-profile). Those files, and what they import
// from ui/ in turn, are copied too; the rest of ui/ stays in NB.
{
  const exts = ['.ts', '.tsx', '/index.ts', '/index.tsx', ''];
  const find = (base) => exts.map((x) => base + x).find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
  const seen = new Set();
  const queue = [];
  const scan = (file, srcFile) => {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;'"]*?from\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const s = m[1] ?? m[2];
      let abs;
      if (s.startsWith('.')) abs = path.resolve(path.dirname(srcFile), s);
      else if (s.startsWith('@kuraykaraaslan-labs/')) abs = path.join(nb, 'modules', s.slice('@kuraykaraaslan-labs/'.length));
      else continue;
      if (!/\/modules\/[a-z_0-9]+\/ui\//.test(abs.replace(/\\/g, '/') + '/')) continue;
      const hit = find(abs);
      if (hit && !seen.has(hit)) { seen.add(hit); queue.push(hit); }
    }
  };
  const all = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? all(path.join(d, e.name)) : [path.join(d, e.name)]);
  for (const id of ids) {
    const dir = path.join(here, 'modules', id);
    for (const f of all(dir).filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.d.ts'))) {
      scan(f, path.join(nb, path.relative(here, f)));
    }
  }
  while (queue.length) {
    const src = queue.pop();
    const dst = path.join(here, path.relative(nb, src));
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    scan(src, src);
  }
  console.log('ui files pulled in by server code:', seen.size);
}

// A package.json export that is not the same path (+ .ts) or a folder index (supervisor/publisher -> supervisor.publisher.ts) becomes
// an explicit tsconfig path; everything else resolves through the wildcard.
{
  const tsPath = path.join(here, 'tsconfig.json');
  const ts = JSON.parse(fs.readFileSync(tsPath, 'utf8'));
  const paths = Object.fromEntries(Object.entries(ts.compilerOptions.paths).filter(([k]) => !k.startsWith('@kuraykaraaslan-labs/') || k === '@kuraykaraaslan-labs/*' || k === '@kuraykaraaslan-labs/automation_integrations'));
  const odd = {};
  for (const id of ids) {
    const f = path.join(nb, 'modules', id, 'package.json');
    if (!fs.existsSync(f)) continue;
    for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(f, 'utf8')).exports ?? {})) {
      if (k === '.' || typeof v !== 'string' || v.includes('/ui/') || !v.endsWith('.ts')) continue;
      const kk = k.slice(2), vv = v.slice(2);
      if ([`${kk}.ts`, `${kk}/index.ts`, kk].includes(vv)) continue;
      odd[`@kuraykaraaslan-labs/${id}/${kk}`] = [`./modules/${id}/${vv}`];
    }
  }
  const order = ['@/*', ...Object.keys(odd).sort(), '@kuraykaraaslan-labs/automation_integrations', '@kuraykaraaslan-labs/*', 'next/server', 'next/headers', 'next'];
  ts.compilerOptions.paths = Object.fromEntries(order.map((k) => [k, odd[k] ?? paths[k]]));
  fs.writeFileSync(tsPath, JSON.stringify(ts, null, 2) + '\n');
  console.log('tsconfig paths:', Object.keys(odd).length, 'explicit');
}

const gi = process.argv.indexOf('--generated');
if (gi > 0) {
  const gen = path.resolve(process.argv[gi + 1]);
  for (const m of ['common', 'db']) {
    const from = path.join(gen, 'modules', m, 'server', 'generated'), to = path.join(here, 'modules', m, 'server', 'generated');
    if (!fs.existsSync(from)) continue;
    fs.rmSync(to, { recursive: true, force: true });
    fs.mkdirSync(to, { recursive: true });
    copyDir(from, to);
    console.log('generated', m);
  }
  // The entity list names every module's entities; keep Core's only (the snapshot keeps all entities on purpose).
  const ent = path.join(here, 'modules', 'db', 'server', 'generated', 'db.entities.generated.ts');
  if (fs.existsSync(ent)) {
    const coreIds = new Set(ids);
    const drop = new Set();
    const lines = fs.readFileSync(ent, 'utf8').split('\n').filter((line) => {
      const m = line.match(/^import \{([^}]+)\} from '@kuraykaraaslan-labs\/([a-z_0-9]+)\//);
      if (!m || coreIds.has(m[2])) return true;
      for (const n of m[1].split(',')) drop.add(n.trim().split(' as ').pop());
      return false;
    }).filter((line) => !/^ {2}[A-Za-z0-9_]+,$/.test(line) || !drop.has(line.trim().slice(0, -1)));
    fs.writeFileSync(ent, lines.join('\n'));
    console.log('entities kept for core; dropped', drop.size);
  }
}
console.log(ids.length, 'core modules');
