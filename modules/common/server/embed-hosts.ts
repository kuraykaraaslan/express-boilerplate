// The third-party origins the page builder's Embed and Map blocks frame (dynamic_page `ui/dynamic/utils/embed.ts`
// turns an author's share link into one of these providers' own embed URLs, and nothing else). Part of the product,
// like the map tiles in map-tiles.ts, so the strict CSP allows them as frame sources itself instead of asking every
// installation to list them in CSP_ALLOWED_HOSTS. Lives in common because the proxy builds the CSP and must not
// import a module that a deployment can switch off.

export const EMBED_FRAME_HOSTS = [
  'https://www.youtube-nocookie.com', 'https://player.vimeo.com', 'https://www.google.com', 'https://maps.google.com',
  'https://open.spotify.com', 'https://w.soundcloud.com', 'https://calendly.com', 'https://form.typeform.com',
  'https://www.figma.com', 'https://codepen.io', 'https://www.loom.com', 'https://docs.google.com', 'https://www.openstreetmap.org',
] as const
