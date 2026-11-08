// Express-side stand-in for `next/server`: the small part of NextRequest / NextResponse the core handlers use,
// built on Node's web Request / Response. Mapped through tsconfig paths (and tsup's alias), never imported by name.
import { parseCookieHeader } from './request-context';

export type CookieOptions = {
  path?: string; domain?: string; maxAge?: number; expires?: Date | number;
  httpOnly?: boolean; secure?: boolean; sameSite?: boolean | 'lax' | 'strict' | 'none'; priority?: string; partitioned?: boolean;
};

export class RequestCookies {
  private readonly map: Map<string, string>;
  constructor(header: string | null) { this.map = parseCookieHeader(header); }
  get(name: string) { const v = this.map.get(name); return v === undefined ? undefined : { name, value: v }; }
  getAll() { return [...this.map].map(([name, value]) => ({ name, value })); }
  has(name: string) { return this.map.has(name); }
  get size() { return this.map.size; }
  [Symbol.iterator]() { return this.getAll().map((c) => [c.name, c] as const)[Symbol.iterator](); }
}

export class NextURL extends URL {
  clone() { return new NextURL(this.href); }
}

export class NextRequest extends Request {
  readonly nextUrl: NextURL;
  readonly cookies: RequestCookies;
  constructor(input: string | URL | Request, init?: RequestInit & { duplex?: 'half' }) {
    super(input as RequestInfo, init);
    this.nextUrl = new NextURL(typeof input === 'string' || input instanceof URL ? input.toString() : (input as Request).url);
    this.cookies = new RequestCookies(this.headers.get('cookie'));
  }
}

function serializeCookie(name: string, value: string, o: CookieOptions = {}): string {
  let s = `${name}=${encodeURIComponent(value)}`;
  if (o.maxAge !== undefined) s += `; Max-Age=${Math.floor(o.maxAge)}`;
  if (o.domain) s += `; Domain=${o.domain}`;
  s += `; Path=${o.path ?? '/'}`;
  if (o.expires !== undefined) s += `; Expires=${new Date(o.expires).toUTCString()}`;
  if (o.httpOnly) s += '; HttpOnly';
  if (o.secure) s += '; Secure';
  if (o.sameSite) s += `; SameSite=${o.sameSite === true ? 'Strict' : o.sameSite[0].toUpperCase() + o.sameSite.slice(1)}`;
  if (o.partitioned) s += '; Partitioned';
  return s;
}

export class ResponseCookies {
  constructor(private readonly headers: Headers) {}
  set(nameOrCookie: string | ({ name: string; value: string } & CookieOptions), value?: string, options?: CookieOptions) {
    if (typeof nameOrCookie === 'string') this.headers.append('set-cookie', serializeCookie(nameOrCookie, value ?? '', options));
    else { const { name, value: v, ...o } = nameOrCookie; this.headers.append('set-cookie', serializeCookie(name, v, o)); }
    return this;
  }
  delete(name: string) { this.headers.append('set-cookie', serializeCookie(name, '', { maxAge: 0, expires: new Date(0) })); return this; }
  get(name: string) {
    for (const line of this.headers.getSetCookie()) {
      const first = line.split(';')[0];
      const i = first.indexOf('=');
      if (first.slice(0, i) === name) return { name, value: decodeURIComponent(first.slice(i + 1)) };
    }
    return undefined;
  }
  getAll() { return this.headers.getSetCookie().map((l) => { const f = l.split(';')[0]; const i = f.indexOf('='); return { name: f.slice(0, i), value: decodeURIComponent(f.slice(i + 1)) }; }); }
}

export class NextResponse<T = unknown> extends Response {
  readonly cookies: ResponseCookies;
  declare readonly _body?: T;
  constructor(body?: BodyInit | null, init?: ResponseInit) {
    super(body, init);
    this.cookies = new ResponseCookies(this.headers);
  }
  static json<D>(data: D, init?: ResponseInit): NextResponse<D> {
    const headers = new Headers(init?.headers);
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    return new NextResponse<D>(JSON.stringify(data), { ...init, headers });
  }
  static redirect(url: string | URL, init?: number | ResponseInit): NextResponse {
    const status = typeof init === 'number' ? init : init?.status ?? 307;
    const headers = new Headers(typeof init === 'object' ? init.headers : undefined);
    headers.set('location', String(url));
    return new NextResponse(null, { ...(typeof init === 'object' ? init : {}), status, headers });
  }
  static next(init?: ResponseInit): NextResponse {
    const headers = new Headers(init?.headers);
    headers.set('x-middleware-next', '1');
    return new NextResponse(null, { ...init, headers });
  }
}

export const userAgent = (request: Request) => ({ ua: request.headers.get('user-agent') ?? '' });
