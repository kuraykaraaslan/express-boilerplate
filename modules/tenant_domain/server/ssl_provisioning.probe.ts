import tls from 'node:tls';
import { isValidDomainName, normalizeDomainName } from './tenant_domain.dto';

const HANDSHAKE_TIMEOUT_MS = 7_000;

/** A simplified cert summary returned from a successful TLS probe. */
export interface CertProbeResult {
  ok: true;
  issuer: string;
  validFrom: Date;
  validTo: Date;
}

export interface CertProbeFailure {
  ok: false;
  reason: string;
}

/**
 * Opens a TLS handshake to {host}:443, reads the peer cert, and returns
 * a parsed summary. Never throws — TLS errors are normalised to
 * `CertProbeFailure`.
 */
export function probeCertificate(host: string): Promise<CertProbeResult | CertProbeFailure> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: CertProbeResult | CertProbeFailure) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* ignore */ }
      resolve(value);
    };

    const socket = tls.connect({
      host,
      port: 443,
      servername: host,
      // Reject untrusted certs — that's the whole point of the probe.
      rejectUnauthorized: true,
      timeout: HANDSHAKE_TIMEOUT_MS,
    });

    socket.once('secureConnect', () => {
      try {
        const cert = socket.getPeerCertificate(false);
        if (!cert || !cert.valid_from || !cert.valid_to) {
          finish({ ok: false, reason: 'empty-cert' });
          return;
        }
        const issuer = cert.issuer
          ? [cert.issuer.O, cert.issuer.CN].filter(Boolean).join(' — ')
          : 'unknown';
        finish({
          ok: true,
          issuer,
          validFrom: new Date(cert.valid_from),
          validTo: new Date(cert.valid_to),
        });
      } catch (err) {
        finish({ ok: false, reason: err instanceof Error ? err.message : 'parse-failure' });
      }
    });

    socket.once('timeout', () => finish({ ok: false, reason: 'handshake-timeout' }));
    socket.once('error', (err: Error) => finish({ ok: false, reason: err.message }));
  });
}

/**
 * Guard reused by the cron and the on-demand check: only probe real, external
 * customer hostnames — never IP literals or internal/local names.
 */
export function isProbeableHost(domain: string): boolean {
  if (!domain || typeof domain !== 'string') return false;
  // tenant_domain.03: a host name in its one normalised spelling (lower case, no root dot) that is a real DNS name. Every
  // address notation the resolver would also accept (0x7f.0.0.1, 0x7f000001, 2130706433, ::ffff:127.0.0.1, [::1]) fails the
  // host-name grammar, and `localhost.` is `localhost`.
  const host = normalizeDomainName(domain.trim());
  if (!isValidDomainName(host)) return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  return true;
}
