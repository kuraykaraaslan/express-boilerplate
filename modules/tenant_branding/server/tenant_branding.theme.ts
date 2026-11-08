/**
 * Pure helpers that turn a tenant's branding into what a page can apply without trusting it: theme variables from the
 * brand colors, vetted asset URLs, and a CSS url() that cannot break out of its declaration. No I/O; shared by the auth
 * shell, the page metadata and the favicon redirect.
 */

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** A `#rgb` / `#rrggbb` color, normalised to `#rrggbb`, or null. */
export function normalizeHex(value: string | undefined | null): string | null {
  const v = (value ?? '').trim();
  if (!HEX.test(v)) return null;
  const h = v.slice(1).toLowerCase();
  return `#${h.length === 3 ? h.split('').map((c) => c + c).join('') : h}`;
}

const toRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (rgb: number[]) => `#${rgb.map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('')}`;
/** Mix `hex` with `toward` (black or white) by `amount` (0..1). */
const mix = (hex: string, toward: number, amount: number) => toHex(toRgb(hex).map((c) => c + (toward - c) * amount));
/** Mix `hex` with another colour by `amount` (0..1). */
const mixWith = (hex: string, toward: string, amount: number) => {
  const target = toRgb(toward);
  return toHex(toRgb(hex).map((c, i) => c + (target[i] - c) * amount));
};

/** The dark theme's page surface (app/globals.css `.dark --surface-base`), which the dark subtle tint leans toward. */
const DARK_SURFACE = '#0f172a';

/** WCAG relative luminance, for the readable foreground on a brand color. */
function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
/** White or near-black text, whichever reads better on `hex`. */
export function readableOn(hex: string): string {
  const l = luminance(hex);
  return contrast(l, 1) >= contrast(l, luminance('#111827')) ? '#ffffff' : '#111827';
}

const WHITE_TEXT_RATIO = 4.5; // WCAG AA, body text
const MAX_DARKEN = 0.4;

/**
 * The light theme's fill for a brand color: the color itself when white text reads on it (AA), else the first shade
 * toward black (2 % steps, at most 40 %) on which it does, so a mid-tone brand (#269ed1) keeps white button text
 * instead of near-black; a light brand (yellow) that would need more stays as it is, with dark text.
 */
export function lightFill(hex: string): string {
  for (let a = 0; a <= MAX_DARKEN + 1e-9; a += 0.02) {
    const shade = a === 0 ? hex : mix(hex, 0, a);
    if (contrast(luminance(shade), 1) >= WHITE_TEXT_RATIO) return shade;
  }
  return hex;
}

/**
 * The theme variables (app/globals.css token names) a brand color sets, as the platform palette sets them: in the light
 * theme the color (deepened just enough for white text, `lightFill`), darker hover / active shades and a pale tint; in
 * the dark theme (whose fills are light, as `.dark --primary` is) a lighter fill, lighter hover / active shades and a
 * deep tint toward the dark surface. Each theme gets a readable foreground on its own fill.
 */
export function brandPalette(hex: string): { light: Record<string, string>; dark: Record<string, string> } {
  const fill = lightFill(hex);
  const darkFill = mix(hex, 255, 0.3);
  return {
    light: { '': fill, '-hover': mix(fill, 0, 0.12), '-active': mix(fill, 0, 0.24), '-subtle': mix(hex, 255, 0.9), '-fg': readableOn(fill) },
    dark: { '': darkFill, '-hover': mix(hex, 255, 0.45), '-active': mix(hex, 255, 0.6), '-subtle': mixWith(hex, DARK_SURFACE, 0.75), '-fg': readableOn(darkFill) },
  };
}

/**
 * The theme variables a tenant's (or the installation's) brand colors set, light and dark: two rules, `:root` and
 * `:root.dark` (the class next-themes puts on <html>, which outranks globals.css `.dark`). The secondary color is the
 * accent (Button `accent`, the coloured alternative action) and sets its fill, hover and foreground, with the same
 * readable foreground rule as the primary. It sets the same three `--secondary` variables too: the second palette
 * colour that charts, the widget colour option "Secondary", ButtonGroup and a few tints draw with keeps following the
 * brand. No Button reads `--secondary` any more, so the neutral Button `secondary` (Cancel, Back) stays neutral.
 * Invalid or missing colors set nothing (the platform defaults stay).
 */
export function brandThemeCss(colors: { primary?: string | null; secondary?: string | null }): string {
  const light: string[] = [];
  const dark: string[] = [];
  const primary = normalizeHex(colors.primary);
  if (primary) {
    const p = brandPalette(primary);
    for (const suffix of ['', '-hover', '-active', '-subtle', '-fg']) {
      light.push(`--primary${suffix}:${p.light[suffix]}`);
      dark.push(`--primary${suffix}:${p.dark[suffix]}`);
    }
  }
  const secondary = normalizeHex(colors.secondary);
  if (secondary) {
    const s = brandPalette(secondary);
    for (const name of ['--accent', '--secondary']) {
      for (const suffix of ['', '-hover', '-fg']) {
        light.push(`${name}${suffix}:${s.light[suffix]}`);
        dark.push(`${name}${suffix}:${s.dark[suffix]}`);
      }
    }
  }
  return light.length ? `:root{${light.join(';')}}:root.dark{${dark.join(';')}}` : '';
}

/**
 * An asset URL a page may load: absolute http(s), or root-relative on this host (not `//host`, which is another host).
 * Anything else (javascript:, data:, a bare word) is null. The write path already refuses those; this is the read side.
 */
export function safeAssetUrl(value: string | undefined | null): string | null {
  const v = (value ?? '').trim();
  if (!v || v.length > 2048) return null;
  // Browsers drop tab / CR / LF inside URLs, so `/\t/evil.com` resolves to evil.com: no control character anywhere.
  if (/[\u0000-\u001f\u007f]/.test(v)) return null;
  if (v.startsWith('/')) {
    // Root-relative must resolve on THIS origin (not `//host` or `/\host`, which browsers treat as another host).
    const base = 'https://origin.invalid';
    try {
      return new URL(v, base).origin === base ? v : null;
    } catch {
      return null;
    }
  }
  try {
    const url = new URL(v);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** A CSS `url("…")` for a vetted asset URL; quotes, backslashes, newlines and parentheses are escaped. */
export function cssUrl(safeUrl: string): string {
  return `url("${safeUrl.replace(/[\\"'()\n\r\f<>]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)}")`;
}
