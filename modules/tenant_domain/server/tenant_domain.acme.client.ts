import 'reflect-metadata';
import crypto from 'node:crypto';
import { Pkcs10CertificateRequestGenerator, SubjectAlternativeNameExtension, X509Certificate } from '@peculiar/x509';

/**
 * RFC 8555 ACME client (phase 51: one name, HTTP-01; phase 56: several names in one order, a wildcard among them, answered by DNS-01).
 * Written on node:crypto and @peculiar/x509 so the module takes no new dependency: JWS is ES256 signed with the account key, the CSR
 * comes from @peculiar/x509.
 *
 * The client never logs and never puts a key into an error: `AcmeError` carries the CA's problem document (type, detail, status) and
 * nothing else. The only thing that leaves `order()` with a private key is its return value.
 */

export interface ChallengeStore {
  /** Publishes the key authorisation for `token`, where the challenge route answers it from. */
  put(token: string, keyAuthorization: string): Promise<void>;
  del(token: string): Promise<void>;
}

/** One challenge to answer: the authorization's name (`*.` stripped, as the CA sends it), the token and its key authorisation. */
export interface PendingChallenge {
  identifier: string;
  wildcard: boolean;
  token: string;
  keyAuthorization: string;
}

/**
 * How a challenge type is answered. `present` makes one challenge answerable, `ready` (optional) waits until all of them are visible to
 * the CA (DNS propagation), `cleanup` withdraws one. Every presented challenge is withdrawn whatever happens.
 */
export interface ChallengeSolver {
  type: 'http-01' | 'dns-01';
  present(c: PendingChallenge): Promise<void>;
  ready?(all: PendingChallenge[]): Promise<void>;
  cleanup(c: PendingChallenge): Promise<void>;
}

/** The TXT value of a dns-01 challenge (RFC 8555 §8.4): base64url(SHA-256(key authorisation)). */
export function dns01Value(keyAuthorization: string): string {
  return b64u(crypto.createHash('sha256').update(keyAuthorization).digest());
}

/** The HTTP-01 solver over a challenge store (phase 51): the token's key authorisation is what the challenge route answers. */
export function http01Solver(store: ChallengeStore): ChallengeSolver {
  return {
    type: 'http-01',
    present: (c) => store.put(c.token, c.keyAuthorization),
    cleanup: (c) => store.del(c.token),
  };
}

export interface AcmeClientOptions {
  directoryUrl: string;
  /** PKCS#8 PEM of the account key (P-256). Generated when absent; read it back with `accountKeyPem` and keep it sealed. */
  accountKeyPem?: string;
  contactEmail?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

export interface IssuedCertificate {
  /** Leaf first, then the chain, as the CA sent it. */
  certPem: string;
  /** PKCS#8 PEM of the new certificate's private key. */
  keyPem: string;
  notBefore: Date;
  notAfter: Date;
}

interface Directory {
  newNonce: string;
  newAccount: string;
  newOrder: string;
}

interface Problem { type?: string; detail?: string; status?: number }

export class AcmeError extends Error {
  constructor(message: string, readonly problemType: string | null = null, readonly status: number | null = null, readonly retryAfterMs: number | null = null) {
    super(message);
    this.name = 'AcmeError';
  }
  /** Let's Encrypt limits (50 new certificates per registered domain a week, 5 duplicates): the caller backs off for a long time, not minutes. */
  get rateLimited(): boolean { return this.problemType?.endsWith(':rateLimited') ?? false; }
}

const b64u = (b: Buffer | string): string => Buffer.from(b).toString('base64url');
const NONCE_RETRIES = 2;

export class AcmeClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly pollIntervalMs: number;
  private readonly pollTimeoutMs: number;
  private accountKey: crypto.KeyObject;
  private directory: Directory | null = null;
  private kid: string | null = null;
  private nonce: string | null = null;

  constructor(private readonly opts: AcmeClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.pollIntervalMs = opts.pollIntervalMs ?? 2_000;
    this.pollTimeoutMs = opts.pollTimeoutMs ?? 120_000;
    this.accountKey = opts.accountKeyPem
      ? crypto.createPrivateKey(opts.accountKeyPem)
      : crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
  }

  /** PKCS#8 PEM of the account key, for the caller to seal and store. */
  get accountKeyPem(): string {
    return this.accountKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  }

  /** RFC 7638 thumbprint of the account public key (base64url): the second half of every key authorisation. */
  get thumbprint(): string {
    const jwk = this.publicJwk();
    return b64u(crypto.createHash('sha256').update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })).digest());
  }

  private publicJwk(): { kty: string; crv: string; x: string; y: string } {
    const jwk = crypto.createPublicKey(this.accountKey).export({ format: 'jwk' });
    return { kty: jwk.kty as string, crv: jwk.crv as string, x: jwk.x as string, y: jwk.y as string };
  }

  private async dir(): Promise<Directory> {
    if (this.directory) return this.directory;
    const res = await this.fetchImpl(this.opts.directoryUrl);
    if (!res.ok) throw new AcmeError(`directory unavailable (${res.status})`, null, res.status);
    const body = (await res.json()) as Partial<Directory>;
    if (!body.newNonce || !body.newAccount || !body.newOrder) throw new AcmeError('directory is missing newNonce/newAccount/newOrder');
    this.directory = { newNonce: body.newNonce, newAccount: body.newAccount, newOrder: body.newOrder };
    return this.directory;
  }

  private async freshNonce(): Promise<string> {
    const res = await this.fetchImpl((await this.dir()).newNonce, { method: 'HEAD' });
    const n = res.headers.get('replay-nonce');
    if (!n) throw new AcmeError('the CA sent no Replay-Nonce');
    return n;
  }

  /** One signed POST (payload `null` = POST-as-GET). Retries once on badNonce, as RFC 8555 §6.5 asks. */
  private async post(url: string, payload: unknown | null, withJwk = false): Promise<{ body: unknown; res: Response; text: string }> {
    for (let attempt = 0; ; attempt++) {
      const nonce = this.nonce ?? (await this.freshNonce());
      this.nonce = null;
      const protectedHeader = { alg: 'ES256', nonce, url, ...(withJwk ? { jwk: this.publicJwk() } : { kid: this.kid }) };
      const p = b64u(JSON.stringify(protectedHeader));
      const pl = payload === null ? '' : b64u(JSON.stringify(payload));
      const sig = crypto.sign('sha256', Buffer.from(`${p}.${pl}`), { key: this.accountKey, dsaEncoding: 'ieee-p1363' });
      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/jose+json' },
        body: JSON.stringify({ protected: p, payload: pl, signature: b64u(sig) }),
      });
      this.nonce = res.headers.get('replay-nonce');
      const text = await res.text();
      if (res.ok) {
        let body: unknown = null;
        if ((res.headers.get('content-type') ?? '').includes('json')) { try { body = JSON.parse(text); } catch { /* the caller reads `text` */ } }
        return { body, res, text };
      }
      let problem: Problem = {};
      try { problem = JSON.parse(text) as Problem; } catch { /* not a problem document */ }
      if (problem.type?.endsWith(':badNonce') && attempt < NONCE_RETRIES) continue;
      const retryAfter = Number(res.headers.get('retry-after'));
      throw new AcmeError(problem.detail ?? `the CA answered ${res.status}`, problem.type ?? null, res.status, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : null);
    }
  }

  /** Registers the account (or finds it again by its key). Idempotent. */
  async ensureAccount(): Promise<void> {
    if (this.kid) return;
    const { newAccount } = await this.dir();
    const { res } = await this.post(newAccount, {
      termsOfServiceAgreed: true,
      ...(this.opts.contactEmail ? { contact: [`mailto:${this.opts.contactEmail}`] } : {}),
    }, true);
    const kid = res.headers.get('location');
    if (!kid) throw new AcmeError('the CA sent no account location');
    this.kid = kid;
  }

  private async pollUntil(url: string, done: (o: { status?: string }) => boolean, what: string): Promise<Record<string, unknown>> {
    const deadline = Date.now() + this.pollTimeoutMs;
    for (;;) {
      const { body } = await this.post(url, null);
      const o = (body ?? {}) as { status?: string; error?: Problem; challenges?: { type?: string; error?: Problem }[] };
      if (o.status === 'invalid') {
        // An order carries its own `error`; an authorization says why in the failed challenge ("Fetching http://host/...: Connection refused").
        const why = o.error ?? o.challenges?.find((c) => c.error)?.error;
        throw new AcmeError(`${what} was refused: ${why?.detail ?? 'invalid'}`, why?.type ?? null);
      }
      if (done(o)) return o as Record<string, unknown>;
      if (Date.now() >= deadline) throw new AcmeError(`${what} did not settle in time`);
      await this.sleep(this.pollIntervalMs);
    }
  }

  /**
   * Orders one certificate for `domain` by HTTP-01 and returns it. The challenge token is withdrawn from `store` whatever happens.
   * Throws `AcmeError`; the caller decides the back-off (`rateLimited`, `retryAfterMs`).
   */
  async order(domain: string, store: ChallengeStore): Promise<IssuedCertificate> {
    return this.orderNames([domain], http01Solver(store));
  }

  /**
   * Orders one certificate for every name in `names` (the first is the subject; `*.<base>` is a wildcard) and returns it. Every pending
   * authorization is answered with `solver`'s challenge type: all are presented first, then `ready` is awaited, then the CA is told, so
   * two TXT values at one name (`<base>` and `*.<base>` share `_acme-challenge.<base>`) are both there when the CA looks. Every presented
   * challenge is withdrawn whatever happens. Throws `AcmeError`.
   */
  async orderNames(names: string[], solver: ChallengeSolver): Promise<IssuedCertificate> {
    if (!names.length) throw new AcmeError('no names to order');
    await this.ensureAccount();
    const { newOrder } = await this.dir();
    const created = await this.post(newOrder, { identifiers: names.map((value) => ({ type: 'dns', value })) });
    const orderUrl = created.res.headers.get('location');
    const order = created.body as { authorizations?: string[]; finalize?: string };
    if (!orderUrl || !order.authorizations?.length || !order.finalize) throw new AcmeError('the CA sent an incomplete order');

    type Authz = { status?: string; identifier?: { value?: string }; wildcard?: boolean; challenges?: { type: string; url: string; token: string }[] };
    const pending: Array<{ authzUrl: string; challengeUrl: string; challenge: PendingChallenge }> = [];
    for (const authzUrl of order.authorizations) {
      const authz = (await this.post(authzUrl, null)).body as Authz;
      if (authz.status === 'valid') continue;
      const challenge = authz.challenges?.find((c) => c.type === solver.type);
      if (!challenge) throw new AcmeError(`the CA offered no ${solver.type} challenge for ${authz.identifier?.value ?? 'a name'}`);
      pending.push({
        authzUrl,
        challengeUrl: challenge.url,
        challenge: { identifier: authz.identifier?.value ?? names[0].replace(/^\*\./, ''), wildcard: authz.wildcard === true, token: challenge.token, keyAuthorization: `${challenge.token}.${this.thumbprint}` },
      });
    }
    const presented: PendingChallenge[] = [];
    try {
      for (const p of pending) { await solver.present(p.challenge); presented.push(p.challenge); }
      if (presented.length && solver.ready) await solver.ready(presented);
      for (const p of pending) await this.post(p.challengeUrl, {});
      for (const p of pending) await this.pollUntil(p.authzUrl, (o) => o.status === 'valid', `the challenge for ${p.challenge.wildcard ? '*.' : ''}${p.challenge.identifier}`);
    } finally {
      for (const c of presented) await solver.cleanup(c).catch(() => undefined);
    }

    const keys = await globalThis.crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const csr = await Pkcs10CertificateRequestGenerator.create({
      name: `CN=${names[0]}`,
      keys,
      signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
      extensions: [new SubjectAlternativeNameExtension(names.map((value) => ({ type: 'dns' as const, value })))],
    }, globalThis.crypto);
    await this.post(order.finalize, { csr: b64u(Buffer.from(csr.rawData)) });

    const done = await this.pollUntil(orderUrl, (o) => o.status === 'valid', 'the order');
    const certificateUrl = done.certificate as string | undefined;
    if (!certificateUrl) throw new AcmeError('the CA sent no certificate URL');
    const { text } = await this.post(certificateUrl, null);
    const leaf = new X509Certificate(text.slice(0, text.indexOf('-----END CERTIFICATE-----') + '-----END CERTIFICATE-----'.length));
    const pkcs8 = Buffer.from(await globalThis.crypto.subtle.exportKey('pkcs8', keys.privateKey)).toString('base64');
    const keyPem = `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`;
    return { certPem: text, keyPem, notBefore: leaf.notBefore, notAfter: leaf.notAfter };
  }
}
