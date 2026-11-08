// The installation's map tile source (MAP_TILES_*, docs/guides/install-config.md "The map's tiles"): the root layout hands
// it to every map (`MapTilesProvider`), and the CSP lets the browser load its images. Pure over the values it is given:
// the layout passes the validated `env`, the proxy (which runs before the env schema is loaded) `process.env`.

/** The tile source as the kit's `MapTileSource`: a Leaflet URL template, its attribution, `{s}` subdomains, deepest zoom, dark URL. */
export type InstallMapTileSource = {
  url: string;
  attribution: string;
  subdomains?: string | string[];
  maxZoom?: number;
  darkUrl?: string;
};

/** The MAP_TILES_* values: the validated `env` (strings and a number) or the raw `process.env` (strings). */
type MapTilesEnv = Readonly<Record<string, unknown>>;

const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/**
 * The tile source the settings describe, or null (unset: the kit's default, OpenStreetMap). A URL without an attribution
 * is null too (the env schema refuses that at boot; the proxy reads the raw values). The kit checks the source again.
 */
export function mapTileSourceOf(e: MapTilesEnv): InstallMapTileSource | null {
  const url = text(e.MAP_TILES_URL);
  const attribution = text(e.MAP_TILES_ATTRIBUTION);
  if (!url || !attribution) return null;
  const subs = text(e.MAP_TILES_SUBDOMAINS);
  const maxZoom = Number(e.MAP_TILES_MAX_ZOOM);
  const darkUrl = text(e.MAP_TILES_DARK_URL);
  return {
    url,
    attribution,
    ...(subs ? { subdomains: subs.includes(',') ? subs.split(',').map((s) => s.trim()) : subs } : {}),
    ...(e.MAP_TILES_MAX_ZOOM !== undefined && e.MAP_TILES_MAX_ZOOM !== '' && Number.isInteger(maxZoom) ? { maxZoom } : {}),
    ...(darkUrl ? { darkUrl } : {}),
  };
}

/** The default basemap's image origin: OpenStreetMap's standard tiles (the kit's OSM_TILES). */
export const OSM_TILE_ORIGIN = 'https://tile.openstreetmap.org';

const ORIGIN_RE = /^https:\/\/(?:\*\.)?[A-Za-z0-9.-]+(?::\d+)?$/;

/**
 * The image origins a CSP must allow for a tile source: each URL's scheme and host, with `{s}` as a wildcard when it is
 * the host's first label (`https://*.tiles.example.com`) and as each subdomain otherwise. An origin that is not a plain
 * https host after that is left out (the map then shows no tiles from it, which the browser's CSP report names).
 */
export function mapTileOrigins(source: InstallMapTileSource | null): string[] {
  if (!source) return [];
  const subs = source.subdomains === undefined ? ['a', 'b', 'c'] : Array.isArray(source.subdomains) ? source.subdomains : [...source.subdomains];
  const out = new Set<string>();
  for (const url of [source.url, source.darkUrl]) {
    const origin = url ? /^https:\/\/[^/?#]+/.exec(url)?.[0] : undefined;
    if (!origin) continue;
    const hosts = origin.startsWith('https://{s}.') ? [origin.replace('{s}', '*')] : origin.includes('{s}') ? subs.map((s) => origin.replace(/\{s\}/g, s)) : [origin];
    for (const h of hosts) if (ORIGIN_RE.test(h)) out.add(h);
  }
  return [...out];
}
