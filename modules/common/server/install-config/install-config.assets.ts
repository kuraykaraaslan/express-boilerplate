// Where a brand asset of config/brand.ts is loaded from. No imports: the root layout and the proxy read it.

/** The public folder `npm run config:check` copies config/ asset files into, and the URL prefix they are served at. */
export const INSTALL_ASSET_DIR = 'public/brand/install';
export const INSTALL_ASSET_URL = '/brand/install/';

/** True for an http(s) or root-relative URL; anything else in config/brand.ts is a file under config/. */
export function isAssetUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || value.startsWith('/');
}

/** The file name an asset file is published under: its base name (config:check refuses two files with one name). */
export function assetFileName(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).pop() ?? value;
}

/** What a page loads for a config/brand.ts asset: a URL as written, a config/ file at its published URL. */
export function brandAssetUrl(value: string | undefined | null): string | undefined {
  const v = (value ?? '').trim();
  if (!v) return undefined;
  return isAssetUrl(v) ? v : `${INSTALL_ASSET_URL}${encodeURIComponent(assetFileName(v))}`;
}
