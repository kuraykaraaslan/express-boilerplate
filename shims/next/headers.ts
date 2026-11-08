import { currentRequest, parseCookieHeader } from './request-context';

export async function headers(): Promise<Headers> { return currentRequest().headers; }

export async function cookies() {
  const map = parseCookieHeader(currentRequest().headers.get('cookie'));
  return {
    get: (name: string) => { const v = map.get(name); return v === undefined ? undefined : { name, value: v }; },
    getAll: () => [...map].map(([name, value]) => ({ name, value })),
    has: (name: string) => map.has(name),
  };
}
