import { env } from '@kuraykaraaslan-labs/env';
import { withSystemRLS } from '@kuraykaraaslan-labs/db';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { SETTING_KEYS_BY_MODULE } from '@kuraykaraaslan-labs/common/server/setting-keys.catalog';
import { ROOT_TENANT_ID, isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';

// ── payment: the default gateway stays switched on (08-payment review, 3.7) ────────────────────────────────────────────
// Checkout resolves its gateway as payment's `resolveEnabledProvider` does: the explicit choice, else the tenant's
// `paymentDefaultProvider` (own row, else ROOT's), else the platform default `PAYMENT_DEFAULT_PROVIDER` (STRIPE when
// unset); and it refuses (422) a gateway whose `<provider>Enabled` flag is exactly 'false'. A settings write that left
// the default gateway switched off therefore made every checkout that does not name a gateway fail. The payment
// settings dialog locked the switch, but only in the browser and only while `paymentDefaultProvider` was set.
//
// The rule lives here, like the other cross-module value rules of the generic settings API (tenant_setting.validation,
// tenant_setting.ip-lists), because payment requires tenant_setting and tenant_setting cannot import payment. It reads
// payment's keys from the generated setting-key catalog, and a payment test (payment.default-provider-guard.test)
// keeps the two in step: every gateway's flag, and the platform default.

/** payment's `DEFAULT_PROVIDER` (payment.checkout.registry): the gateway used when no tenant names one. */
export function platformDefaultPaymentProvider(): string {
  return env.PAYMENT_DEFAULT_PROVIDER?.toUpperCase() || 'STRIPE';
}

/**
 * The enable flag of a gateway: payment's key named `<provider>Enabled`, compared without case (STRIPE → stripeEnabled,
 * WECHATPAY → wechatPayEnabled). Null for a name that is no gateway payment declares a flag for.
 */
export function paymentProviderEnabledKey(provider: string): string | null {
  const want = `${provider}enabled`.toLowerCase();
  return (SETTING_KEYS_BY_MODULE.payment ?? []).find((key) => key.toLowerCase() === want) ?? null;
}

const DEFAULT_PROVIDER_KEY = 'paymentDefaultProvider';

/** `details.messageKey` of the two refusals, for a settings screen that translates them (the message is the English). */
export const PAYMENT_DEFAULT_SWITCH_OFF_MESSAGE_KEY = 'tenant_setting.errors.paymentDefaultProviderSwitchOff';
export const PAYMENT_DEFAULT_DISABLED_MESSAGE_KEY = 'tenant_setting.errors.paymentDefaultProviderDisabled';

/**
 * Refuse (409) a settings write after which the tenant's effective default gateway is switched off: a write that sets
 * the default gateway's flag to 'false', or that names (or, by clearing `paymentDefaultProvider`, falls back to) a
 * default whose flag is 'false'. `current` reads a key's effective value (own row, else ROOT's), as checkout reads it.
 * A write that touches neither the default nor its flag passes, whatever is stored. The refusal names the key to fix in
 * `details.key` (the settings screens show it under that field).
 */
export async function assertPaymentDefaultProviderStaysEnabled(
  settings: Record<string, string>,
  current: (key: string) => Promise<string | null>,
): Promise<void> {
  const touchesDefault = DEFAULT_PROVIDER_KEY in settings;
  const touchesAFlag = Object.keys(settings).some((key) => key.endsWith('Enabled') && paymentProviderEnabledKey(key.slice(0, -'Enabled'.length)) === key);
  if (!touchesDefault && !touchesAFlag) return;

  const after = async (key: string): Promise<string | null> =>
    key in settings ? settings[key] : await current(key).catch(() => null);

  const named = String((await after(DEFAULT_PROVIDER_KEY)) ?? '').trim();
  const provider = named.toUpperCase() || platformDefaultPaymentProvider();
  const flag = paymentProviderEnabledKey(provider);
  // A name that is no gateway: checkout refuses it on its own (unknown provider); nothing to keep on here.
  if (!flag) return;
  if (!touchesDefault && !(flag in settings)) return;
  if ((await after(flag)) !== 'false') return;

  // Which change to undo: switching the default's flag off, else choosing (or falling back to) a switched-off default.
  const switchingOff = flag in settings;
  throw new AppError(
    switchingOff
      ? `${provider} is the default payment provider, so it cannot be switched off. Make another provider the default first.`
      : `${provider} is switched off, so it cannot be the default payment provider. Switch it on first, or choose another provider.`,
    409,
    ErrorCode.CONFLICT,
    {
      details: {
        key: switchingOff ? flag : DEFAULT_PROVIDER_KEY,
        messageKey: switchingOff ? PAYMENT_DEFAULT_SWITCH_OFF_MESSAGE_KEY : PAYMENT_DEFAULT_DISABLED_MESSAGE_KEY,
        vars: { provider },
      },
    },
  );
}

// ── ROOT's values are other tenants' defaults (08 review D) ──────────────────────────────────────────────────────────
// A tenant without its own row reads ROOT's (tenant_setting.read.service `inheritsFromRoot`): both the default gateway
// and each gateway's flag. A ROOT write checked against ROOT's own values alone could therefore break tenants it never
// looked at:
//  (a) ROOT switches gateway X off: a tenant whose OWN default is X (or whose own default is blank and X is the platform
//      default) and that has no own `XEnabled` row now reads ROOT's 'false';
//  (b) ROOT changes its default to Y: a tenant with no own default row now defaults to Y, and its own `YEnabled` may be
//      'false'.
// Both are counted on the shared database in one query each (COUNT, never a list), and the write is refused (409) with
// the count. Tenants on a dedicated database (`tenant_databases`) keep their rows there and are not counted: their
// inherited values still come from ROOT, so this is a floor, never a clearance. Deleted tenants are not counted.

export const PAYMENT_DEFAULT_INHERITED_SWITCH_OFF_MESSAGE_KEY = 'tenant_setting.errors.paymentDefaultProviderInheritedSwitchOff';
export const PAYMENT_DEFAULT_INHERITED_DISABLED_MESSAGE_KEY = 'tenant_setting.errors.paymentDefaultProviderInheritedDisabled';

/** How many other tenants a ROOT write would leave with a switched-off default gateway (08 review D). */
export interface InheritedDefaultCounter {
  /** (a) Tenants whose own default is `provider` (or blank, when `blankIsProvider`) and that have no own `flag` row. */
  ownDefaultWithoutOwnFlag(provider: string, flag: string, blankIsProvider: boolean): Promise<number>;
  /** (b) Tenants whose own `flag` is 'false' and that have no own `paymentDefaultProvider` row. */
  ownFlagOffWithoutOwnDefault(flag: string): Promise<number>;
}

const LIVE_TENANT = `JOIN "tenants" t ON t."tenantId" = s."tenantId" AND t."deletedAt" IS NULL`;

/** SQL of (a): $1 the default key, $2 the gateway (upper case), $3 whether a blank default is that gateway, $4 the flag, $5 ROOT. */
export const OWN_DEFAULT_WITHOUT_OWN_FLAG_SQL = `SELECT COUNT(DISTINCT s."tenantId")::int AS "n" FROM "settings" s ${LIVE_TENANT}
  WHERE s."key" = $1 AND s."tenantId" <> $5
    AND (UPPER(TRIM(s."value")) = $2 OR ($3::boolean AND TRIM(s."value") = ''))
    AND NOT EXISTS (SELECT 1 FROM "settings" f WHERE f."tenantId" = s."tenantId" AND f."key" = $4)`;

/** SQL of (b): $1 the flag, $2 the default key, $3 ROOT. */
export const OWN_FLAG_OFF_WITHOUT_OWN_DEFAULT_SQL = `SELECT COUNT(DISTINCT s."tenantId")::int AS "n" FROM "settings" s ${LIVE_TENANT}
  WHERE s."key" = $1 AND s."value" = 'false' AND s."tenantId" <> $3
    AND NOT EXISTS (SELECT 1 FROM "settings" d WHERE d."tenantId" = s."tenantId" AND d."key" = $2)`;

const countOf = (rows: unknown): number => {
  const n = Number((Array.isArray(rows) ? (rows[0] as { n?: unknown } | undefined)?.n : undefined) ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/**
 * The counts over every tenant's rows: a platform-wide read (the RLS-bypassing system connection), as the tenant sweeps
 * do; only a ROOT write reaches it. The values compared are the gateway names and flags, which are not secret settings
 * (`isSensitiveKey`), so they are stored as written.
 */
export const sqlInheritedDefaultCounter: InheritedDefaultCounter = {
  ownDefaultWithoutOwnFlag: (provider, flag, blankIsProvider) => withSystemRLS(async (qr) =>
    countOf(await qr.query(OWN_DEFAULT_WITHOUT_OWN_FLAG_SQL, [DEFAULT_PROVIDER_KEY, provider.toUpperCase(), blankIsProvider, flag, ROOT_TENANT_ID]))),
  ownFlagOffWithoutOwnDefault: (flag) => withSystemRLS(async (qr) =>
    countOf(await qr.query(OWN_FLAG_OFF_WITHOUT_OWN_DEFAULT_SQL, [flag, DEFAULT_PROVIDER_KEY, ROOT_TENANT_ID]))),
};

/** The gateway a flag key switches (`stripeEnabled` → STRIPE, `wechatPayEnabled` → WECHATPAY), or null for any other key. */
function providerOfFlag(key: string): string | null {
  if (!key.endsWith('Enabled')) return null;
  const provider = key.slice(0, -'Enabled'.length).toUpperCase();
  return provider && paymentProviderEnabledKey(provider) === key ? provider : null;
}

/** True for the keys the default-gateway guard judges: `paymentDefaultProvider` and payment's gateway flags. */
export function isPaymentDefaultSettingKey(key: string): boolean {
  return key === DEFAULT_PROVIDER_KEY || providerOfFlag(key) !== null;
}

const effectiveDefault = (named: string | null): string => String(named ?? '').trim().toUpperCase() || platformDefaultPaymentProvider();

/**
 * (08 review D) Refuse (409) a ROOT settings write that would leave other tenants, which read ROOT's values where they
 * have no row of their own, with a switched-off default gateway: (a) and (b) above. Only a change counts (a flag that is
 * already 'false', a default that stays the same, passes: the write does not make it worse). A count that cannot be read
 * refuses the write (503, retryable): checkout for every tenant hangs on it. The refusal names the key and the number of
 * tenants, never the tenants.
 */
export async function assertRootPaymentDefaultKeepsTenants(
  settings: Record<string, string>,
  current: (key: string) => Promise<string | null>,
  counter: InheritedDefaultCounter = sqlInheritedDefaultCounter,
): Promise<void> {
  const before = async (key: string): Promise<string | null> => current(key).catch(() => null);
  const count = async (run: () => Promise<number>): Promise<number> => {
    try {
      return await run();
    } catch {
      throw new AppError('Could not check the tenants that inherit these payment settings; try again.', 503, ErrorCode.PROVIDER_UNAVAILABLE, { retryable: true });
    }
  };
  const refuse = (message: string, key: string, messageKey: string, provider: string, tenants: number) => new AppError(
    message, 409, ErrorCode.CONFLICT, { details: { key, messageKey, vars: { provider, count: tenants } } },
  );

  // (a) A gateway switched off here is switched off for every tenant that names it its own default without its own flag.
  for (const [key, value] of Object.entries(settings)) {
    const provider = providerOfFlag(key);
    if (!provider || value !== 'false' || (await before(key)) === 'false') continue;
    const tenants = await count(() => counter.ownDefaultWithoutOwnFlag(provider, key, provider === platformDefaultPaymentProvider()));
    if (tenants > 0) {
      throw refuse(
        `${provider} is the default payment provider of ${tenants} tenant(s) that use the platform's setting for it, so it cannot be switched off here.`,
        key, PAYMENT_DEFAULT_INHERITED_SWITCH_OFF_MESSAGE_KEY, provider, tenants,
      );
    }
  }

  // (b) A new default here is the default of every tenant without its own: refused where that tenant switched it off.
  if (DEFAULT_PROVIDER_KEY in settings) {
    const next = effectiveDefault(settings[DEFAULT_PROVIDER_KEY]);
    const flag = paymentProviderEnabledKey(next);
    if (flag && next !== effectiveDefault(await before(DEFAULT_PROVIDER_KEY))) {
      const tenants = await count(() => counter.ownFlagOffWithoutOwnDefault(flag));
      if (tenants > 0) {
        throw refuse(
          `${next} is switched off by ${tenants} tenant(s) that use the platform's default payment provider, so it cannot be the default here.`,
          DEFAULT_PROVIDER_KEY, PAYMENT_DEFAULT_INHERITED_DISABLED_MESSAGE_KEY, next, tenants,
        );
      }
    }
  }
}

/**
 * Every default-gateway check of a settings write of `tenantId` (the direct write, and a parked change when it is approved
 * and applied): the tenant's own effective default stays switched on, and a ROOT write does not switch it off for the
 * tenants that inherit ROOT's values. `current` reads the tenant's effective values at that moment.
 */
export async function assertPaymentDefaultWriteAllowed(
  tenantId: string,
  settings: Record<string, string>,
  current: (key: string) => Promise<string | null>,
  counter: InheritedDefaultCounter = sqlInheritedDefaultCounter,
): Promise<void> {
  await assertPaymentDefaultProviderStaysEnabled(settings, current);
  if (isRootTenant(tenantId)) await assertRootPaymentDefaultKeepsTenants(settings, current, counter);
}
