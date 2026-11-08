import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import AuthMessages from './auth.messages';
import redis from '@kuraykaraaslan-labs/redis';
import Logger from '@kuraykaraaslan-labs/logger';
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';

import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
/**
 * KD-19: brute-force CAPTCHA threshold.
 * Tracks per-identity failed-login counters in Redis with a 30 min rolling
 * window. Once the count crosses the configured threshold, the next login
 * attempt MUST present a CAPTCHA token verified against the configured
 * reCAPTCHA server key.
 */
const WINDOW_SECONDS = 60 * 30;

function key(email: string): string {
  return `auth:captcha-counter:${email.toLowerCase()}`;
}

export default class CaptchaService {
  static async isRequired(email: string, triggerAttempts: number): Promise<boolean> {
    if (triggerAttempts <= 0) return false;
    const count = parseInt((await redis.get(key(email))) ?? '0', 10);
    if (count < triggerAttempts) return false;
    // 38-security 2.4 / A-5: a challenge is demanded only when a provider can verify it. With none installed and configured the
    // threshold still counts (and the login lockout still applies) but never turns three failures into a login block anyone can trigger.
    if (!(await CaptchaService.providerReady())) {
      Logger.warn('CaptchaService.isRequired: threshold reached but no captcha provider is installed and configured; not demanding a challenge');
      return false;
    }
    return true;
  }

  /**
   * 38-security 2.4: the register endpoint's challenge. The first REGISTER_FREE sign-ups per address per window pass untouched
   * (a household, an office); beyond that a verified CAPTCHA token is required, but only when a provider is installed and
   * configured (A-5), so a fresh deployment is never locked out of registration. Redis trouble fails open: the IP limiter and the
   * strike store are the other layers.
   *
   * Phase 55 02.6: `marked` (the AI firewall's `auth.signup_captcha` mark on the address, auth.signup-protection.ts) asks for the token from
   * the first sign-up, still only while a provider is ready.
   */
  static async guardRegister(ipAddress: string | undefined, captchaToken?: string, opts: { marked?: boolean } = {}): Promise<void> {
    if (!ipAddress) return;
    let count = 0;
    try {
      const k = `auth:captcha-register:${ipAddress}`;
      count = Number(await redis.incr(k)) || 0;
      if (count === 1) await redis.expire(k, WINDOW_SECONDS);
    } catch {
      return;
    }
    if (count <= CaptchaService.REGISTER_FREE && opts.marked !== true) return;
    if (!(await CaptchaService.providerReady())) return;
    if (!captchaToken) throw new AppError(AuthMessages.CAPTCHA_REQUIRED, 400, ErrorCode.VALIDATION_ERROR);
    if (!(await CaptchaService.verify(captchaToken))) throw new AppError(AuthMessages.CAPTCHA_INVALID, 400, ErrorCode.VALIDATION_ERROR);
  }

  static readonly REGISTER_FREE = 3;

  /** Whether a captcha provider plugin is installed AND configured platform-wide (ROOT tenant). Any error counts as "not ready". */
  static async providerReady(): Promise<boolean> {
    try {
      const { listExternalContributions } = await import('@kuraykaraaslan-labs/common/server/external-extensions');
      const exts = await listExternalContributions(ROOT_TENANT_ID, 'captcha:provider');
      return exts.some((c) => c.configured);
    } catch {
      return false;
    }
  }

  /** Counts a failed attempt for the identity and returns how many are in the window. */
  static async recordFailure(email: string): Promise<number> {
    const k = key(email);
    const count = await redis.incr(k);
    if (count === 1) await redis.expire(k, WINDOW_SECONDS);
    return Number(count) || 0;
  }

  /**
   * 38-security 2.6: the sleep after the nth failed attempt in the window, `min(2^n x 250 ms, 4 s)`. Slows online guessing without
   * ever locking a legitimate user out. 0 for no failures. Pure.
   */
  static progressiveDelayMs(failures: number): number {
    if (!(failures >= 1)) return 0;
    return Math.min(2 ** Math.min(Math.floor(failures), 20) * 250, 4000);
  }

  /** Sleeps the progressive delay for the nth failure (timer based). `AUTH_PROGRESSIVE_DELAY=off` disables it (the test setup does). */
  static async delayAfterFailure(failures: number): Promise<void> {
    if (process.env.AUTH_PROGRESSIVE_DELAY === 'off') return;
    const ms = CaptchaService.progressiveDelayMs(failures);
    if (ms > 0) await new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  static async clear(email: string): Promise<void> {
    await redis.del(key(email)).catch(() => {});
  }

  /**
   * Verify a CAPTCHA token against the configured provider. CAPTCHA providers are
   * SANDBOXED community plugins (the captcha plugin family — reCAPTCHA / hCaptcha /
   * Turnstile) resolved platform-wide (ROOT tenant) via the external-contributions
   * bridge; the provider secret stays host-side. Fail-CLOSED: returns false when no
   * provider is installed/configured or verification errors (if you enable the
   * CAPTCHA threshold you must install + configure a provider).
   */
  static async verify(token: string): Promise<boolean> {
    if (!token) return false;
    try {
      const { listExternalContributions } = await import('@kuraykaraaslan-labs/common/server/external-extensions');
      const exts = await listExternalContributions(ROOT_TENANT_ID, 'captcha:provider');
      if (exts.length === 0) {
        Logger.warn('CaptchaService.verify: no captcha provider installed; rejecting captcha token');
        return false;
      }
      const wanted = (await SettingService.getValue(ROOT_TENANT_ID, 'captchaProvider').catch(() => null)) || 'recaptcha';
      const ext = exts.find((c) => c.key === wanted) ?? exts.find((c) => c.configured) ?? exts[0];
      const res = (await ext.invoke('verify', { token })) as { success?: boolean } | null;
      return !!res?.success;
    } catch (err: unknown) {
      Logger.warn(`CaptchaService.verify: request failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }
}
