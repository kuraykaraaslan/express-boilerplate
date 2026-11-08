// 05-tenant-member 6.4: the dictionary keys of a module's manifest permissions.
//
// A module.json `permissions[]` entry describes a permission in English (`name`, optional `description`, `group`).
// Whatever renders one (the access-control matrix, the group editor, ...) shows each string as
// `t(<key>, <English from the manifest>)`, so a missing key or locale still reads in English. The keys, and the slug
// rules that build them, live only here; scripts/i18n/extract.mjs (plain JS, it cannot import this file) applies the
// same rules to add the keys to the owning module's en.json, and scripts/i18n/permission-labels.parity.test.ts checks
// that both agree.
//
// Keys (moduleId = the module whose module.json declares the permission, NOT the id's prefix: auth declares
// `account.*` ids, auth_oidc_provider declares `fleet_id.*`; the key lives in the declaring module's dictionary,
// which ships to the admin page whenever that module is enabled, the same condition under which the matrix lists it):
//   name         <moduleId>.permission.<idSlug>.name
//   description  <moduleId>.permission.<idSlug>.description      (only when the manifest has a description)
//   group        <moduleId>.permissionGroup.<groupSlug>
//
// Slug rules (deterministic, never contain a dot):
//   idSlug     the permission id with every character outside [A-Za-z0-9_] replaced by '_' (case kept):
//              'members.view' -> 'members_view', 'accounting.accounts.read_all' -> 'accounting_accounts_read_all';
//              '' -> '_empty'.
//   groupSlug  the English group lower-cased, every run of characters outside [a-z0-9] replaced by one '_',
//              leading/trailing '_' trimmed: 'Chart of Accounts' -> 'chart_of_accounts', 'E-Invoicing (TR)' ->
//              'e_invoicing_tr', 'AI' -> 'ai'; nothing left -> '_empty'.
// Two ids of one module that slug alike ('a.b_c' / 'a_b.c'), or two groups that do, would share a key: the parity
// test refuses that.
//
// The same English group in two modules has two keys (one per module dictionary); a list that merges groups across
// modules labels the heading through the module of its first permission.
//
// No module imports here: the `t` parameter is any (key, fallback) => string, e.g. useT() in a client component or
// `(k, f) => serverT(k, locale, f)` on the server.

/** A `t` function: the key, the English fallback. */
export type PermissionLabelTranslate = (key: string, fallback: string) => string;

/** The manifest fields a label needs (a module.json `permissions[]` entry, or the matrix row built from one). */
export interface PermissionLabelSource {
  id: string;
  name: string;
  description?: string | null;
  group?: string | null;
}

/** The id segment of a key: the permission id, characters outside [A-Za-z0-9_] -> '_'; '' -> '_empty'. */
export function permissionIdSlug(id: string): string {
  const slug = id.replace(/[^A-Za-z0-9_]/g, '_');
  return slug === '' ? '_empty' : slug;
}

/** The group segment of a key: lower-cased, non-[a-z0-9] runs -> '_', trimmed; nothing left -> '_empty'. */
export function permissionGroupSlug(group: string): string {
  const slug = group.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return slug === '' ? '_empty' : slug;
}

/** `<moduleId>.permission.<idSlug>.name | .description`. */
export function permissionKeys(moduleId: string, permissionId: string): { name: string; description: string } {
  const base = `${moduleId}.permission.${permissionIdSlug(permissionId)}`;
  return { name: `${base}.name`, description: `${base}.description` };
}

/** `<moduleId>.permission.<idSlug>.name`. */
export function permissionNameKey(moduleId: string, permissionId: string): string {
  return permissionKeys(moduleId, permissionId).name;
}

/** `<moduleId>.permission.<idSlug>.description`. */
export function permissionDescriptionKey(moduleId: string, permissionId: string): string {
  return permissionKeys(moduleId, permissionId).description;
}

/** `<moduleId>.permissionGroup.<groupSlug>`. */
export function permissionGroupKey(moduleId: string, group: string): string {
  return `${moduleId}.permissionGroup.${permissionGroupSlug(group)}`;
}

/**
 * Every key the given permissions need, with its English text from the manifest: what the module's `en.json` holds
 * for them. Groups are listed once, in first-seen order. Entries without an id or a string name are skipped.
 */
export function permissionMessages(moduleId: string, permissions: readonly PermissionLabelSource[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of permissions) {
    if (!p || typeof p.id !== 'string' || typeof p.name !== 'string') continue;
    const k = permissionKeys(moduleId, p.id);
    out[k.name] = p.name;
    if (typeof p.description === 'string' && p.description) out[k.description] = p.description;
    if (typeof p.group === 'string' && p.group) {
      const g = permissionGroupKey(moduleId, p.group);
      if (!(g in out)) out[g] = p.group;
    }
  }
  return out;
}

/** The permission's name, translated (the manifest English is the fallback). */
export function permissionLabel(t: PermissionLabelTranslate, moduleId: string, perm: PermissionLabelSource): string {
  return t(permissionNameKey(moduleId, perm.id), perm.name);
}

/** The permission's description, translated; undefined when the manifest has none. */
export function permissionDescription(t: PermissionLabelTranslate, moduleId: string, perm: PermissionLabelSource): string | undefined {
  return perm.description ? t(permissionDescriptionKey(moduleId, perm.id), perm.description) : undefined;
}

/** A permission group heading, translated (the English group is the fallback). */
export function permissionGroupLabel(t: PermissionLabelTranslate, moduleId: string, group: string): string {
  return t(permissionGroupKey(moduleId, group), group);
}

// ── Role templates (05-tenant-member 6.4) ───────────────────────────────────────────────────────────────────────────
//
// A `tenant_member:role_template` contribution (a module's `*.role-template.ts`, declared in its module.json
// `extensions[]`) exports `{ key, label, description?, permissions }` with English text. The picker shows them as
// `t(<key>, <English from the contribution>)`; the keys live in the CONTRIBUTING module's dictionary (the module whose
// module.json declares the contribution; the text is its own):
//   label        <moduleId>.roleTemplate.<templateSlug>.label
//   description  <moduleId>.roleTemplate.<templateSlug>.description   (only when the contribution has one)
// templateSlug: the template key under the idSlug rule ('store_operator' -> 'store_operator', 'ops.lead' -> 'ops_lead').
// Several modules contribute to one key and merge (commerce_order + commerce_fulfillment + ... make store_operator):
// each declares the keys in its own dictionary, and the label reads from the first contributor, in the template's
// `moduleIds` order, whose dictionary has it; with none, the English the API sent. scripts/i18n/extract.mjs adds these
// keys to the contributor's en.json from the contribution file.

/** A role template as the picker gets it (GET /api/access-control/role-templates). */
export interface RoleTemplateLabelSource {
  key: string;
  label: string;
  description?: string | null;
  /** The contributing modules, in merge order. Absent: nothing to translate through, the English is shown. */
  moduleIds?: readonly string[] | null;
}

/** The template segment of a key: the idSlug rule. */
export function roleTemplateSlug(key: string): string {
  return permissionIdSlug(key);
}

/** `<moduleId>.roleTemplate.<templateSlug>.label | .description`. */
export function roleTemplateKeys(moduleId: string, templateKey: string): { label: string; description: string } {
  const base = `${moduleId}.roleTemplate.${roleTemplateSlug(templateKey)}`;
  return { label: `${base}.label`, description: `${base}.description` };
}

/** Every key one module's contributions need, with their English: what its `en.json` holds for them. */
export function roleTemplateMessages(moduleId: string, templates: readonly Pick<RoleTemplateLabelSource, 'key' | 'label' | 'description'>[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tpl of templates) {
    if (!tpl || typeof tpl.key !== 'string' || !tpl.key) continue;
    const k = roleTemplateKeys(moduleId, tpl.key);
    if (typeof tpl.label === 'string' && tpl.label) out[k.label] = tpl.label;
    if (typeof tpl.description === 'string' && tpl.description) out[k.description] = tpl.description;
  }
  return out;
}

/** Never a dictionary value: tells "no translation" from a translation that reads like the English. */
const NO_TRANSLATION = '\u0000';

function firstTranslation(t: PermissionLabelTranslate, moduleIds: readonly string[] | null | undefined, keyOf: (moduleId: string) => string, english: string): string {
  for (const moduleId of moduleIds ?? []) {
    const v = t(keyOf(moduleId), NO_TRANSLATION);
    if (v !== NO_TRANSLATION) return v;
  }
  return english;
}

/** The template's label, translated through its first contributor that has the key; else the English. */
export function roleTemplateLabel(t: PermissionLabelTranslate, tpl: RoleTemplateLabelSource): string {
  return firstTranslation(t, tpl.moduleIds, (m) => roleTemplateKeys(m, tpl.key).label, tpl.label);
}

/** The template's description, translated the same way; undefined when it has none. */
export function roleTemplateDescription(t: PermissionLabelTranslate, tpl: RoleTemplateLabelSource): string | undefined {
  return tpl.description ? firstTranslation(t, tpl.moduleIds, (m) => roleTemplateKeys(m, tpl.key).description, tpl.description) : undefined;
}
