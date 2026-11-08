import { z } from 'zod';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { INSTALL_ROLES, type InstallAccessRule, type InstallMenuLayer } from './install-config.define';

// The validation of the three config files (install-config.define.ts). Strict objects: a misspelled key is an error,
// never a silently ignored setting.

const text = (max: number) => z.string().trim().min(1).max(max);
const hexColor = z.string().trim().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'expected a hex colour like #269ed1');

/**
 * A file under config/ (`assets/logo.svg`) or an http(s) / root-relative URL. Paths may not leave config/ and URLs may
 * not carry another scheme; install-config.assets.ts turns either into what a page loads.
 */
const asset = z.string().trim().min(1).max(2048).refine(
  (v) => !/[\u0000-\u001f\u007f]/.test(v)
    && (/^https?:\/\/[^/]/i.test(v) || (/^\/[^/\\]/.test(v)) || (!/^[a-z][a-z0-9+.-]*:/i.test(v) && !v.startsWith('/') && !v.split(/[\\/]/).includes('..'))),
  'expected a file under config/ (assets/logo.svg) or an http(s) or root-relative URL',
);

export const InstallBrandSchema = z.strictObject({
  name: text(120).optional(),
  shortName: text(16).optional(),
  logo: z.strictObject({ light: asset.optional(), dark: asset.optional() }).optional(),
  icon: z.strictObject({ light: asset.optional(), dark: asset.optional() }).optional(),
  favicon: asset.optional(),
  primaryColor: hexColor.optional(),
  secondaryColor: hexColor.optional(),
  defaultTheme: z.enum(['light', 'dark', 'system']).optional(),
  mail: z.strictObject({ senderName: text(120).optional() }).optional(),
  signIn: z.strictObject({ title: text(120).optional(), subtitle: text(240).optional() }).optional(),
});

const icon = z.custom<IconDefinition>(
  (v) => typeof v === 'object' && v !== null && typeof (v as IconDefinition).iconName === 'string' && Array.isArray((v as IconDefinition).icon),
  'expected a Font Awesome icon definition (import { faHouse } from "@fortawesome/free-solid-svg-icons")',
);
const key = z.string().min(1).max(200);
/** `MenuLabel`: one text, or one per language code (`{ en: 'Flows', tr: 'Akışlar' }`, at least one). */
const menuLabel = (max: number) => z.union([
  text(max),
  z.record(z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/, 'expected a language code like en, tr or pt-BR'), text(max))
    .refine((m) => Object.keys(m).length > 0, 'give the label in at least one language'),
]);

const MenuItemOverrideSchema = z.strictObject({
  hidden: z.boolean().optional(),
  label: menuLabel(120).optional(),
  group: key.optional(),
  workspace: key.optional(),
  order: z.number().int().optional(),
});

const MenuWorkspaceOverrideSchema = z.strictObject({
  hidden: z.boolean().optional(),
  label: menuLabel(60).optional(),
  icon: icon.optional(),
  order: z.number().int().optional(),
});

const MenuGroupOverrideSchema = z.strictObject({
  label: menuLabel(120).optional(),
  workspace: key.optional(),
});

export const InstallMenuLayerSchema: z.ZodType<InstallMenuLayer> = z.strictObject({
  workspaces: z.union([z.literal('single'), z.record(key, MenuWorkspaceOverrideSchema)]).optional(),
  groups: z.record(key, MenuGroupOverrideSchema).optional(),
  items: z.record(key, MenuItemOverrideSchema).optional(),
});

const byRole = <T extends z.ZodType>(schema: T) =>
  z.strictObject(Object.fromEntries(INSTALL_ROLES.map((r) => [r, schema.optional()])) as Record<(typeof INSTALL_ROLES)[number], z.ZodOptional<T>>);

export const InstallMenuSchema = z.strictObject({
  workspaces: z.union([z.literal('single'), z.record(key, MenuWorkspaceOverrideSchema)]).optional(),
  groups: z.record(key, MenuGroupOverrideSchema).optional(),
  items: z.record(key, MenuItemOverrideSchema).optional(),
  roles: byRole(InstallMenuLayerSchema).optional(),
  customGroups: z.record(key, InstallMenuLayerSchema).optional(),
});

const permissionId = z.string().regex(/^[a-z0-9_]+(?:\.[a-z0-9_]+)+$/, 'expected a permission id like blog.posts.read');

const InstallAccessRuleSchema: z.ZodType<InstallAccessRule> = z.strictObject({
  remove: z.array(permissionId).optional(),
  grant: z.array(permissionId).optional(),
});

export const InstallAccessSchema = z.strictObject({
  roles: byRole(InstallAccessRuleSchema).optional(),
  customGroups: z.record(key, InstallAccessRuleSchema).optional(),
});

const moduleId = z.string().regex(/^[a-z][a-z0-9_]*$/, 'expected a module id like iot_automation');

export const InstallModulesSchema = z.strictObject({
  included: z.array(moduleId).optional(),
  hidden: z.array(moduleId).optional(),
});
