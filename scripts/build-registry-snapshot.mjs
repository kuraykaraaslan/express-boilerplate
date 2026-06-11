#!/usr/bin/env node
// Builds offline AI-discoverable artifacts for express-boilerplate.
//
//   1. public/registry/registry.json        — full catalog (modules + routes + entities + components + conventions)
//   2. public/registry/registry.index.json  — lightweight index (no inlined README bodies)
//   3. public/registry/modules.json         — modules only (full, with README bodies)
//   4. public/registry/routes.json          — Express route inventory
//   5. public/registry/entities.json        — TypeORM entity inventory
//   6. public/registry/components.json      — modules_express/ middleware + service.express inventory
//   7. public/modules/<id>.md               — per-module markdown chunk
//   8. public/modules/_index.json           — { id → { tier, file, … } }
//
// Pure Node — walks the filesystem and parses with conservative regex.
// Re-run via `npm run registry:snapshot`.

import { readdir, readFile, writeFile, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const PKG_JSON_PATH       = path.join(REPO_ROOT, 'package.json');
const MODULES_DIR         = path.join(REPO_ROOT, 'modules');
const MODULES_EXPRESS_DIR = path.join(REPO_ROOT, 'modules_express');
const ROUTER_DIR          = path.join(REPO_ROOT, 'router');
const OUT_REGISTRY_DIR    = path.join(REPO_ROOT, 'public/registry');
const OUT_MODULES_DIR     = path.join(REPO_ROOT, 'public/modules');

// --- generic walkers ------------------------------------------------------

async function walk(dir, predicate, out = []) {
  let ents;
  try { ents = await readdir(dir, { withFileTypes: true }); }
  catch { return out; }
  for (const e of ents) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, predicate, out);
    else if (e.isFile() && predicate(full, e.name)) out.push(full);
  }
  return out;
}

async function listDirs(dir) {
  let ents;
  try { ents = await readdir(dir, { withFileTypes: true }); }
  catch { return []; }
  return ents.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);
}

function rel(p) { return path.relative(REPO_ROOT, p).split(path.sep).join('/'); }

async function readJson(p) {
  try { return JSON.parse(await readFile(p, 'utf8')); }
  catch { return null; }
}

async function readText(p) {
  try { return await readFile(p, 'utf8'); }
  catch { return null; }
}

async function exists(p) {
  try { await stat(p); return true; }
  catch { return false; }
}

// --- module tier classification ------------------------------------------

const TIER_BY_ID = {
  common: 'infrastructure', env: 'infrastructure', logger: 'infrastructure',
  redis: 'infrastructure', db: 'infrastructure', redis_idempotency: 'infrastructure',
  limiter: 'infrastructure', api_doc: 'infrastructure',

  user: 'identity', user_profile: 'identity', user_security: 'identity',
  user_preferences: 'identity', user_session: 'identity', user_social_account: 'identity',
  user_agent: 'identity', auth: 'identity', auth_sso: 'identity', auth_saml: 'identity',
  auth_impersonation: 'identity',

  tenant: 'tenancy', tenant_member: 'tenancy', tenant_invitation: 'tenancy',
  tenant_setting: 'tenancy', tenant_session: 'tenancy', tenant_branding: 'tenancy',
  tenant_domain: 'tenancy', tenant_subscription: 'tenancy', tenant_usage: 'tenancy',
  tenant_export: 'tenancy',

  notification_mail: 'notifications', notification_sms: 'notifications',
  notification_push: 'notifications', notification_inapp: 'notifications',

  payment: 'billing', coupon: 'billing',

  setting: 'platform', storage: 'platform', webhook: 'platform',
  audit_log: 'platform', api_key: 'platform',

  ai: 'ai',
};

// --- module collection ----------------------------------------------------

const FILE_BUCKETS = [
  ['services',    /\.service\.ts$/],
  ['dtos',        /\.dto\.ts$/],
  ['enums',       /\.enums\.ts$/],
  ['messageKeys', /\.messages\.ts$/],
  ['settingKeys', /\.setting\.keys\.ts$/],
  ['providers',   /\.provider\.ts$/],
  ['jobs',        /\.job\.ts$/],
];

async function collectModuleExports(moduleDir) {
  const out = { services: [], dtos: [], enums: [], messageKeys: [], settingKeys: [], providers: [], jobs: [], entities: [] };
  let entries;
  try { entries = await readdir(moduleDir, { withFileTypes: true }); }
  catch { return out; }

  for (const e of entries) {
    if (!e.isFile()) continue;
    if (e.name.endsWith('.test.ts')) continue;
    for (const [bucket, re] of FILE_BUCKETS) {
      if (re.test(e.name)) { out[bucket].push(e.name); break; }
    }
  }

  const entitiesDir = path.join(moduleDir, 'entities');
  if (await exists(entitiesDir)) {
    const ents = await readdir(entitiesDir);
    out.entities = ents.filter((n) => n.endsWith('.entity.ts'));
  }

  const providersDir = path.join(moduleDir, 'providers');
  if (await exists(providersDir)) {
    const provs = await readdir(providersDir);
    out.providers = [...out.providers, ...provs.filter((n) => n.endsWith('.provider.ts'))];
  }

  return out;
}

function deriveTitleFromReadme(readme, id) {
  if (!readme) return id;
  const m1 = readme.match(/^#\s+(.+?)\s*$/m);
  if (m1) return m1[1].replace(/\s+module$/, '').trim();
  return id;
}

function deriveDescriptionFromReadme(readme) {
  if (!readme) return '';
  const lines = readme.split('\n');
  let i = 0;
  while (i < lines.length && (lines[i].startsWith('#') || lines[i].trim() === '')) i++;
  const buf = [];
  while (i < lines.length && lines[i].trim() !== '' && !lines[i].startsWith('#') && !lines[i].startsWith('---')) {
    buf.push(lines[i].trim());
    i++;
  }
  return buf.join(' ').trim();
}

async function collectModules() {
  const ids = (await listDirs(MODULES_DIR)).filter((n) => n !== 'README.md');
  const modules = [];
  for (const id of ids) {
    const dir = path.join(MODULES_DIR, id);
    const moduleJson = await readJson(path.join(dir, 'module.json'));
    const readme = await readText(path.join(dir, 'README.md'));
    const exports = await collectModuleExports(dir);
    const hasExpressLayer = await exists(path.join(MODULES_EXPRESS_DIR, id));

    const name = moduleJson?.name ?? deriveTitleFromReadme(readme, id) ?? id;
    const description = moduleJson?.description ?? deriveDescriptionFromReadme(readme);

    modules.push({
      id,
      name,
      version: moduleJson?.version ?? '0.0.0',
      description,
      dir: rel(dir),
      icon: moduleJson?.icon,
      tags: moduleJson?.tags ?? [],
      priority: moduleJson?.priority ?? 100,
      tier: TIER_BY_ID[id] ?? 'other',
      dependencies: moduleJson?.dependencies ?? { requires: [], optional: [], conflicts: [] },
      exports,
      hasReadme: !!readme,
      hasModuleJson: !!moduleJson,
      hasExpressLayer,
      readme: readme ?? '',
    });
  }
  modules.sort((a, b) => (a.priority - b.priority) || a.id.localeCompare(b.id));
  return modules;
}

// --- route inventory ------------------------------------------------------

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all'];

function parseRouterMounts(indexSource) {
  // Find `<varname>.use("/mount", importedName)` calls, plus map each
  // imported name back to the source file via the `import x from './foo'`
  // declaration above.
  const imports = new Map(); // local name → relative path (e.g. './auth')
  const importRe = /^\s*import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"]/gm;
  let m;
  while ((m = importRe.exec(indexSource)) !== null) imports.set(m[1], m[2]);

  const mounts = []; // { mount: '/auth', localName: 'authRouter', filename: 'auth' }
  const useRe = /\.use\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g;
  while ((m = useRe.exec(indexSource)) !== null) {
    const localName = m[2];
    const importPath = imports.get(localName);
    if (!importPath) continue;
    const filename = importPath.replace(/^.*\//, '').replace(/\.(ts|js|mjs)$/, '');
    mounts.push({ mount: m[1], localName, filename });
  }
  return mounts;
}

function parseRouterHandlers(source) {
  // Match `<anyVar>.<METHOD>(<path>, ...)` where path is a string or template.
  const out = [];
  const re = new RegExp(
    String.raw`([A-Za-z_$][\w$]*)\s*\.\s*(${HTTP_METHODS.join('|')})\s*\(\s*['"\`]([^'"\`]+)['"\`]`,
    'g',
  );
  let m;
  while ((m = re.exec(source)) !== null) {
    out.push({ method: m[2].toUpperCase(), routerPath: m[3] });
  }
  return out;
}

function joinUrl(...parts) {
  const joined = parts.map((p) => (p ?? '')).join('/').replace(/\/+/g, '/');
  if (joined.length > 1 && joined.endsWith('/')) return joined.slice(0, -1);
  return joined || '/';
}

async function collectRoutes() {
  const routes = [];
  for (const scope of ['system', 'tenant']) {
    const scopeDir = path.join(ROUTER_DIR, scope);
    if (!(await exists(scopeDir))) continue;

    const indexSrc = (await readText(path.join(scopeDir, 'index.ts'))) ?? '';
    const mounts = parseRouterMounts(indexSrc);
    const mountByFilename = new Map(mounts.map((mt) => [mt.filename, mt.mount]));

    // Top-level handlers attached directly in router/<scope>/index.ts
    for (const h of parseRouterHandlers(indexSrc)) {
      const urlPath = joinUrl('/', scope, h.routerPath);
      routes.push({
        filePath: rel(path.join(scopeDir, 'index.ts')),
        scope,
        urlPath,
        method: h.method,
        module: undefined,
        dynamic: /:[A-Za-z_]/.test(urlPath),
      });
    }

    // Per-module router files
    const files = (await readdir(scopeDir)).filter((n) => n.endsWith('.ts') && n !== 'index.ts');
    for (const file of files) {
      const moduleId = file.replace(/\.ts$/, '');
      const src = (await readText(path.join(scopeDir, file))) ?? '';
      const mountPath = mountByFilename.get(moduleId);
      const scopePrefix = scope === 'tenant' ? '/tenant/:tenantId' : '/system';

      for (const h of parseRouterHandlers(src)) {
        const urlPath = joinUrl(scopePrefix, mountPath ?? `/${moduleId.replace(/_/g, '-')}`, h.routerPath);
        routes.push({
          filePath: rel(path.join(scopeDir, file)),
          scope,
          urlPath,
          method: h.method,
          module: moduleId,
          dynamic: /:[A-Za-z_]/.test(urlPath),
        });
      }
    }
  }

  routes.sort((a, b) =>
    a.urlPath.localeCompare(b.urlPath) || a.method.localeCompare(b.method),
  );
  return routes;
}

// --- entity inventory -----------------------------------------------------

function parseEntity(source, fallbackName) {
  const classM = source.match(/@Entity\s*\(([^)]*)\)\s*export\s+class\s+(\w+)/)
              ?? source.match(/export\s+class\s+(\w+)/);
  let name = fallbackName;
  let tableName;
  let schema = 'unknown';
  const ent = source.match(/@Entity\s*\(\s*(?:\{([^}]*)\}|['"]([^'"]+)['"])/);
  if (ent) {
    if (ent[2]) tableName = ent[2];
    if (ent[1]) {
      const nameM = ent[1].match(/name\s*:\s*['"]([^'"]+)['"]/);
      if (nameM) tableName = nameM[1];
      const schemaM = ent[1].match(/schema\s*:\s*['"]([^'"]+)['"]/);
      if (schemaM) schema = schemaM[1];
    }
  }
  if (classM) name = classM[classM.length - 1];

  const columns = [];
  const colRe = /@(?:Column|PrimaryGeneratedColumn|PrimaryColumn|CreateDateColumn|UpdateDateColumn|DeleteDateColumn|VersionColumn)\b[\s\S]*?\n\s*([a-zA-Z_$][\w$]*)\s*[!?:]/g;
  let m;
  while ((m = colRe.exec(source)) !== null) columns.push(m[1]);

  const relations = [];
  const relRe = /@(?:ManyToOne|OneToMany|OneToOne|ManyToMany|JoinColumn|JoinTable)\b[\s\S]*?\n\s*([a-zA-Z_$][\w$]*)\s*[!?:]/g;
  while ((m = relRe.exec(source)) !== null) relations.push(m[1]);

  return { name, tableName, schema, columns: [...new Set(columns)], relations: [...new Set(relations)] };
}

async function collectEntities() {
  const files = await walk(MODULES_DIR, (full) => /\/entities\/[^/]+\.entity\.ts$/.test(full));
  const entities = [];
  for (const file of files) {
    const src = (await readText(file)) ?? '';
    const fallback = path.basename(file).replace(/\.entity\.ts$/, '');
    const parsed = parseEntity(src, fallback);
    const moduleId = rel(file).split('/')[1];
    let schema = parsed.schema;
    if (schema === 'unknown') {
      schema = (moduleId.startsWith('tenant') || moduleId === 'audit_log' || moduleId === 'api_key' || moduleId === 'webhook')
        ? 'tenant'
        : 'system';
    }
    entities.push({
      name: parsed.name,
      filePath: rel(file),
      module: moduleId,
      schema,
      tableName: parsed.tableName,
      columns: parsed.columns,
      relations: parsed.relations,
    });
  }
  entities.sort((a, b) => a.name.localeCompare(b.name));
  return entities;
}

// --- modules_express middleware / service inventory ----------------------

function parseNamedExports(source) {
  const out = new Set();
  const re1 = /export\s+(?:async\s+)?(?:function|const|let|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = re1.exec(source)) !== null) out.add(m[1]);
  const re2 = /export\s*\{\s*([^}]+)\}/g;
  while ((m = re2.exec(source)) !== null) {
    for (const part of m[1].split(',')) {
      const id = part.trim().split(/\s+as\s+/).pop();
      if (id) out.add(id);
    }
  }
  if (/^\s*export\s+default\b/m.test(source)) out.add('default');
  return [...out];
}

function kindForExpressFile(file) {
  const r = rel(file);
  if (/\.middleware\.ts$/.test(r))       return 'middleware';
  if (/\.service\.express\.ts$/.test(r)) return 'service.express';
  return 'other';
}

async function collectComponents() {
  const files = await walk(MODULES_EXPRESS_DIR, (full, name) => {
    if (name === 'README.md') return false;
    if (name.endsWith('.test.ts')) return false;
    return name.endsWith('.ts');
  });
  const components = [];
  for (const file of files) {
    const src = (await readText(file)) ?? '';
    const r = rel(file);
    const parts = r.split('/');
    const moduleId = parts[1];
    const basename = path.basename(file).replace(/\.ts$/, '');
    components.push({
      id: `${moduleId}/${basename}`,
      module: moduleId,
      filePath: r,
      kind: kindForExpressFile(file),
      exports: parseNamedExports(src),
    });
  }
  components.sort((a, b) => a.id.localeCompare(b.id));
  return components;
}

// --- markdown chunks ------------------------------------------------------

function markdownForModule(mod, related) {
  const lines = [];
  lines.push(`# ${mod.name}`);
  lines.push('');
  lines.push(`- **id:** \`${mod.id}\``);
  lines.push(`- **tier:** ${mod.tier}`);
  if (mod.version && mod.version !== '0.0.0') lines.push(`- **version:** ${mod.version}`);
  lines.push(`- **dir:** \`${mod.dir}/\``);
  if (mod.tags?.length) lines.push(`- **tags:** ${mod.tags.join(', ')}`);
  if (mod.icon) lines.push(`- **icon:** \`${mod.icon}\``);
  lines.push(`- **hasExpressLayer:** ${mod.hasExpressLayer}`);
  lines.push('');
  if (mod.description) { lines.push(mod.description); lines.push(''); }

  const deps = mod.dependencies ?? {};
  if (deps.requires?.length || deps.optional?.length || deps.conflicts?.length) {
    lines.push('## Dependencies', '');
    if (deps.requires?.length)  lines.push(`- **requires:** ${deps.requires.map((d) => `\`${d}\``).join(', ')}`);
    if (deps.optional?.length)  lines.push(`- **optional:** ${deps.optional.map((d) => `\`${d}\``).join(', ')}`);
    if (deps.conflicts?.length) lines.push(`- **conflicts:** ${deps.conflicts.map((d) => `\`${d}\``).join(', ')}`);
    lines.push('');
  }

  const ex = mod.exports ?? {};
  const buckets = [
    ['Services',     ex.services],
    ['DTOs',         ex.dtos],
    ['Entities',     ex.entities],
    ['Enums',        ex.enums],
    ['Message keys', ex.messageKeys],
    ['Setting keys', ex.settingKeys],
    ['Providers',    ex.providers],
    ['Jobs',         ex.jobs],
  ];
  for (const [label, items] of buckets) {
    if (items?.length) {
      lines.push(`## ${label}`, '');
      for (const item of items) lines.push(`- \`${item}\``);
      lines.push('');
    }
  }

  if (related.routes.length) {
    lines.push('## Owned routes', '');
    for (const r of related.routes) lines.push(`- \`${r.scope}\` ${r.method} \`${r.urlPath}\``);
    lines.push('');
  }
  if (related.entities.length) {
    lines.push('## TypeORM entities', '');
    for (const e of related.entities) lines.push(`- \`${e.name}\` (${e.schema}) — \`${e.filePath}\``);
    lines.push('');
  }
  if (related.components.length) {
    lines.push('## Express layer (modules_express/) surface', '');
    for (const c of related.components) lines.push(`- \`${c.id}\` _(${c.kind})_`);
    lines.push('');
  }

  if (mod.readme) {
    lines.push('## README', '', mod.readme.trim(), '');
  }

  return lines.join('\n');
}

// --- main -----------------------------------------------------------------

async function main() {
  const t0 = Date.now();
  console.log('[snapshot] reading package.json …');
  const pkg = await readJson(PKG_JSON_PATH);

  console.log('[snapshot] collecting modules …');
  const modules = await collectModules();

  console.log('[snapshot] collecting routes …');
  const routes = await collectRoutes();

  console.log('[snapshot] collecting entities …');
  const entities = await collectEntities();

  console.log('[snapshot] collecting modules_express middlewares …');
  const components = await collectComponents();

  const layers = {
    router:          'Express routing layer — one file per scope/module under router/. router/index.ts is the proxy router that rewrites /system/* and /tenant/:tenantId/*.',
    modules_express: 'Express binding layer — middlewares (*.middleware.ts) and service extensions (*.service.express.ts) that touch Request / Response. Imports modules/* + Express.',
    modules:         'Framework-agnostic business logic — services, DTOs, entities, types, enums, messages. No express, no Request/Response, no next/*, no react.',
  };
  const conventions = {
    architecture: 'Two layers (plus router/), strict one-way dependency: router/ -> modules_express/ -> modules/. modules/ NEVER imports modules_express/ or router/.',
    fileNaming:   '*.service.ts (logic), *.dto.ts (Zod), *.types.ts, *.enums.ts, *.messages.ts (i18n keys), *.setting.keys.ts, *.entity.ts (TypeORM, under entities/), *.provider.ts (pluggable), *.job.ts (BullMQ), *.middleware.ts (modules_express/), *.service.express.ts (modules_express/), *.test.ts colocated.',
    scopes:       'Two URL scopes: system (super-admin, no tenant) at /system/... and tenant (per-tenant) at /tenant/:tenantId/.... router/index.ts rewrites incoming URLs based on host (TENANCY_MODE=domain) or path prefix (TENANCY_MODE=path).',
    auth:         'JWT (httpOnly cookies + Bearer header), OTP, TOTP, SAML, OAuth (via auth_sso), WebAuthn/Passkeys (user_security). Sessions: user_session. Impersonation: auth_impersonation, always audited. Middleware: modules_express/auth/auth.middleware.ts (factory: AuthMiddleware(role)).',
    testing:      'Jest + supertest. Tests colocated as *.test.ts beside the file under test. Run `npm test` (see package.json).',
    security:     'Read SECURITY.md for the full threat model. Path alias is the single `@/*` -> `./*`. Multi-tenant data isolation enforced by per-tenant TypeORM DataSource (modules/db). Tenant-scoped routers use Router({ mergeParams: true }) so req.params.tenantId is available downstream.',
  };

  const registry = {
    $schema: '/schemas/registry-v1.json',
    name: pkg?.name ?? 'express-boilerplate',
    version: pkg?.version ?? '0.0.0',
    registryVersion: '1.0',
    generatedAt: new Date().toISOString(),
    description: 'Production-grade multi-tenant SaaS API boilerplate on Express 5 + TypeScript, mirroring the next-boilerplate module set.',
    layers,
    conventions,
    modules,
    routes,
    entities,
    components,
  };

  await rm(OUT_REGISTRY_DIR, { recursive: true, force: true });
  await rm(OUT_MODULES_DIR,  { recursive: true, force: true });
  await mkdir(OUT_REGISTRY_DIR, { recursive: true });
  await mkdir(OUT_MODULES_DIR,  { recursive: true });

  const slimModules = modules.map(({ readme, ...rest }) => rest);
  const indexRegistry = { ...registry, modules: slimModules };

  await writeFile(path.join(OUT_REGISTRY_DIR, 'registry.json'),       JSON.stringify(registry,      null, 2) + '\n', 'utf8');
  await writeFile(path.join(OUT_REGISTRY_DIR, 'registry.index.json'), JSON.stringify(indexRegistry, null, 2) + '\n', 'utf8');
  await writeFile(path.join(OUT_REGISTRY_DIR, 'modules.json'),        JSON.stringify({ name: registry.name, registryVersion: registry.registryVersion, generatedAt: registry.generatedAt, modules },    null, 2) + '\n', 'utf8');
  await writeFile(path.join(OUT_REGISTRY_DIR, 'routes.json'),         JSON.stringify({ name: registry.name, registryVersion: registry.registryVersion, generatedAt: registry.generatedAt, routes },     null, 2) + '\n', 'utf8');
  await writeFile(path.join(OUT_REGISTRY_DIR, 'entities.json'),       JSON.stringify({ name: registry.name, registryVersion: registry.registryVersion, generatedAt: registry.generatedAt, entities },   null, 2) + '\n', 'utf8');
  await writeFile(path.join(OUT_REGISTRY_DIR, 'components.json'),     JSON.stringify({ name: registry.name, registryVersion: registry.registryVersion, generatedAt: registry.generatedAt, components }, null, 2) + '\n', 'utf8');

  const indexMap = {};
  for (const mod of modules) {
    const related = {
      routes:     routes.filter((r) => r.module === mod.id),
      entities:   entities.filter((e) => e.module === mod.id),
      components: components.filter((c) => c.module === mod.id),
    };
    const md = markdownForModule(mod, related);
    const file = `${mod.id}.md`;
    await writeFile(path.join(OUT_MODULES_DIR, file), md, 'utf8');
    indexMap[mod.id] = {
      name: mod.name,
      tier: mod.tier,
      tags: mod.tags,
      hasExpressLayer: mod.hasExpressLayer,
      routeCount: related.routes.length,
      entityCount: related.entities.length,
      componentCount: related.components.length,
      file,
    };
  }
  await writeFile(path.join(OUT_MODULES_DIR, '_index.json'), JSON.stringify(indexMap, null, 2) + '\n', 'utf8');

  const ms = Date.now() - t0;
  console.log(`[snapshot] wrote registry — ${modules.length} modules, ${routes.length} routes, ${entities.length} entities, ${components.length} components in ${ms}ms`);
}

main().catch((err) => {
  console.error('[snapshot] failed:', err.stack || err.message);
  process.exit(1);
});
