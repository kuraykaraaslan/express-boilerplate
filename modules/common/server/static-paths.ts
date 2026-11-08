/**
 * Paths served as static files from public/ (or Next's own bundles), never a
 * tenant route. proxy.ts passes them through untouched, and a client building a
 * tenant-scoped URL must leave them unprefixed: under path-mode tenancy
 * `/t/{id}/samples/plant.ifc` is not a file.
 *
 * This module has NO imports on purpose: it is loaded by proxy.ts and by the
 * client bundle alike.
 */
export const STATIC_PATHS: readonly RegExp[] = [
    /^\/_next\/?/,
    /^\/assets\/?/,
    // kui-viewer's web-ifc WASM and the sample 3D models (dashboard viewer.model widget): static files in public/.
    /^\/wasm\/?/,
    /^\/samples\/?/,
    /^\/favicon\.ico$/,
    // NOTE: /robots.txt is intentionally NOT listed: it must rewrite under
    // /tenant/[tenantId] so the per-tenant robots.txt route handler serves it.
    /\.(png|jpg|jpeg|gif|svg|webp|ico|css|js|map|woff|woff2|ttf|eot)$/i,
];

/** Is this path (a query or hash is ignored) one the proxy serves as a static file? */
export function isStaticAssetPath(path: string): boolean {
    const pathname = path.split(/[?#]/, 1)[0] ?? '';
    return STATIC_PATHS.some((regex) => regex.test(pathname));
}
