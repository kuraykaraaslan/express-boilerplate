import {
  SECURITY_TEMPLATES,
  type MailBrandPatch,
  type PlatformMailDefaults,
  type SanitizedBrand,
} from './notification_mail.brand.types';

/**
 * Pure brand logic — no Redis, no registry, no env — so the rules that keep a
 * tenant string from becoming a phishing vector are testable on their own.
 */

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const MAX_NAME = 80;

/** A display name: control characters and angle brackets stripped, bounded. */
function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const v = raw.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  return v || null;
}

/** An origin (`scheme://host[:port]`), http(s) only; anything else is dropped. */
function cleanOrigin(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * A logo must be an absolute HTTPS URL a mail client can fetch with no
 * session. A root-relative value (`/uploads/logo.png`) is resolved against the
 * tenant's origin when that origin is itself HTTPS; `http:`, `data:` and
 * `javascript:` are refused (mixed-content blocking, and `data:` is stripped by
 * most clients anyway).
 */
function cleanLogo(raw: unknown, baseUrl: string | null): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const v = raw.trim();
  try {
    const u = v.startsWith('/') && !v.startsWith('//')
      ? (baseUrl?.startsWith('https:') ? new URL(v, baseUrl) : null)
      : new URL(v);
    if (!u || u.protocol !== 'https:' || u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Validate a source's patch. Anything unusable becomes `null` = platform default. */
export function sanitizeBrandPatch(patch: MailBrandPatch | null | undefined): SanitizedBrand {
  const baseUrl = cleanOrigin(patch?.baseUrl);
  const color = typeof patch?.primaryColor === 'string' ? patch.primaryColor.trim() : '';
  return {
    name: cleanName(patch?.name),
    // Mail is read on light backgrounds by default; the dark logo is the
    // fallback only when no light one exists.
    logoUrl: cleanLogo(patch?.logoLight, baseUrl) ?? cleanLogo(patch?.logoDark, baseUrl),
    primaryColor: HEX_COLOR.test(color) ? color : null,
    baseUrl,
  };
}

/** Merge several sources' sanitized contributions; the first non-null value per field wins. */
export function mergeBrands(brands: SanitizedBrand[]): SanitizedBrand {
  const pick = <K extends keyof SanitizedBrand>(k: K): SanitizedBrand[K] =>
    (brands.map((b) => b[k]).find((v) => v !== null) ?? null) as SanitizedBrand[K];
  return { name: pick('name'), logoUrl: pick('logoUrl'), primaryColor: pick('primaryColor'), baseUrl: pick('baseUrl') };
}

/**
 * The fixed sentence for security mail from a branded tenant WITHOUT a verified
 * domain. It names the platform operator and its support address and cannot be
 * overridden by any tenant value: a mail that says "Acme Bank" in its header
 * but arrives from a shared sender must always say who actually sent it, or the
 * display name alone would make a convincing phishing mail.
 */
export function securityNotice(platformName: string, platformSupportEmail: string): string {
  return `This message was sent by ${platformName} on behalf of the organization named above. `
    + `If you did not expect it, contact ${platformSupportEmail}.`;
}

/** Black or white, whichever reads better on `hex` (WCAG relative luminance). */
export function readableOn(hex: string): string {
  const h = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#111111' : '#ffffff';
}

/**
 * The full template variable set. With an empty brand this is EXACTLY what
 * `getBaseTemplateVars()` produced before branding existed (plus the new keys
 * set to their neutral values), which is what keeps the unbranded mail
 * byte-identical.
 */
export function buildTemplateVars(defaults: PlatformMailDefaults, brand: SanitizedBrand) {
  const base = brand.baseUrl ?? defaults.frontendUrl;
  const brandName = brand.name ?? defaults.appName;
  const branded = Boolean(brand.name || brand.logoUrl || brand.primaryColor);
  const domainVerified = Boolean(brand.baseUrl);
  return {
    // `appName` stays an alias of `brandName` for one release, so a template that
    // still reads it keeps working mid-migration.
    appName: brandName,
    brandName,
    logoUrl: brand.logoUrl,
    primaryColor: brand.primaryColor,
    buttonTextColor: brand.primaryColor ? readableOn(brand.primaryColor) : null,
    baseUrl: base,
    frontendUrl: base,
    loginLink: base + defaults.loginPath,
    resetPasswordLink: base + defaults.resetPasswordPath,
    forgotPasswordLink: base + defaults.forgotPasswordPath,
    termsLink: base + defaults.termsPath,
    privacyLink: base + defaults.privacyPath,
    supportEmail: defaults.supportEmail,
    secureAccountLink: base + defaults.resetPasswordPath,
    // Kept apart from `supportEmail` so the notice can never pick up a tenant value.
    platformName: defaults.appName,
    platformSupportEmail: defaults.supportEmail,
    /** Branded but not on its own verified domain → security mail must say so. */
    unverifiedBrand: branded && !domainVerified,
  };
}

export type MailTemplateVars = ReturnType<typeof buildTemplateVars>;

/** The notice for `templateName`, or '' when none applies. */
export function noticeFor(templateName: string, vars: Partial<MailTemplateVars>): string {
  if (!SECURITY_TEMPLATES.has(templateName) || !vars.unverifiedBrand) return '';
  return securityNotice(vars.platformName ?? '', vars.platformSupportEmail ?? '');
}
