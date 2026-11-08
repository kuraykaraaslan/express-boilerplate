// The request a handler is running for, so next/headers `cookies()` and `headers()` work outside the handler's arguments.
import { AsyncLocalStorage } from 'node:async_hooks';

export const requestContext = new AsyncLocalStorage<Request>();

export function currentRequest(): Request {
  const r = requestContext.getStore();
  if (!r) throw new Error('next/headers was used outside a request');
  return r;
}

export function parseCookieHeader(header: string | null): Map<string, string> {
  const out = new Map<string, string>();
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    if (!name || out.has(name)) continue;
    let value = part.slice(i + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try { out.set(name, decodeURIComponent(value)); } catch { out.set(name, value); }
  }
  return out;
}
