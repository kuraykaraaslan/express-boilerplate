import { env } from '@kuraykaraaslan-labs/env';

/**
 * Where the BROWSER should open its realtime socket.
 *
 * ## Why this is shared and not three copies
 *
 * Three ticket routes answer the same question — `messaging`, `dynamic_page`
 * and `telephony` — and they answered it differently. The first two fell back to
 * the legacy `MESSAGING_WS_PUBLIC_URL`; the third did not. A deployment that set
 * only the legacy name therefore had working chat, working collaboration, and a
 * softphone that reported itself unconfigured. Nothing documented that
 * asymmetry, and nothing would have caught it.
 *
 * ## The development default is the point
 *
 * `WS_PORT` already defaults to 4001 (`env.schema.core.ts`), `docker-compose`
 * already publishes 4001, and `ws:dev` already listens on 4001. The one thing
 * with no default was the URL the browser is told — so `npm run dev` produced a
 * softphone that refused to connect to a gateway sitting at a completely
 * predictable address. Guessing there is not a guess; it is reading back the
 * default that already exists everywhere else.
 *
 * ## Production never guesses
 *
 * Deriving a host in production — from `Host`, from a wildcard, from anything —
 * fails by silently connecting to the WRONG place, which is strictly worse than
 * the honest `null` that makes a screen say "your operator has not set this".
 * So the dev default is hard-gated on `NODE_ENV`, and production returns
 * `source: 'none'` for the setup screen to render as an operator task.
 */

export type WsUrlSource =
  /** An operator said so explicitly. Always wins. */
  | 'env'
  /** The legacy `MESSAGING_WS_PUBLIC_URL`. Works, but should be renamed. */
  | 'legacy-env'
  /** Read back from the port that already defaults everywhere else. */
  | 'dev-default'
  /** Nobody has said, and we refuse to invent one. */
  | 'none';

export interface ResolvedWsUrl {
  url: string | null;
  source: WsUrlSource;
  /** One sentence a setup screen can show verbatim. */
  detail: string;
}

export function resolveWsPublicUrl(): ResolvedWsUrl {
  if (env.WS_PUBLIC_URL) {
    return { url: env.WS_PUBLIC_URL, source: 'env', detail: 'From WS_PUBLIC_URL.' };
  }

  if (env.MESSAGING_WS_PUBLIC_URL) {
    return {
      url: env.MESSAGING_WS_PUBLIC_URL,
      source: 'legacy-env',
      detail: 'From the legacy MESSAGING_WS_PUBLIC_URL — rename it to WS_PUBLIC_URL.',
    };
  }

  if (env.NODE_ENV !== 'production') {
    const port = env.WS_PORT ?? env.MESSAGING_WS_PORT ?? 4001;
    return {
      url: `http://localhost:${port}`,
      source: 'dev-default',
      detail: `Guessed for development only — the gateway's own default port is ${port}. Set WS_PUBLIC_URL before deploying.`,
    };
  }

  return {
    url: null,
    source: 'none',
    detail: 'Set WS_PUBLIC_URL on the app process to the address browsers reach the realtime gateway on (wss:// when the app is served over https).',
  };
}
