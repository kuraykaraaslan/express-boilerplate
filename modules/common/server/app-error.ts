export const ErrorCode = {
  // Authentication & Session
  UNAUTHORIZED:               'UNAUTHORIZED',
  SESSION_EXPIRED:            'SESSION_EXPIRED',
  INVALID_CREDENTIALS:        'INVALID_CREDENTIALS',
  OTP_REQUIRED:               'OTP_REQUIRED',
  TOTP_REQUIRED:              'TOTP_REQUIRED',
  /** auth.05: the account must change its password before anything else; only the change-password step answers. */
  PASSWORD_CHANGE_REQUIRED:   'PASSWORD_CHANGE_REQUIRED',

  // Authorization
  FORBIDDEN:                  'FORBIDDEN',
  INSUFFICIENT_PERMISSIONS:   'INSUFFICIENT_PERMISSIONS',
  INSUFFICIENT_SCOPE:         'INSUFFICIENT_SCOPE',

  // Tenant
  TENANT_NOT_FOUND:           'TENANT_NOT_FOUND',
  TENANT_INACTIVE:            'TENANT_INACTIVE',
  TENANT_SUSPENDED:           'TENANT_SUSPENDED',
  NOT_TENANT_MEMBER:          'NOT_TENANT_MEMBER',
  /** The request's client IP is outside the tenant's `ipWhitelist` or inside its `ipBlacklist` (tenant_session.policy.ts). */
  TENANT_IP_NOT_ALLOWED:      'TENANT_IP_NOT_ALLOWED',

  // Billing
  SUBSCRIPTION_REQUIRED:      'SUBSCRIPTION_REQUIRED',
  SUBSCRIPTION_EXPIRED:       'SUBSCRIPTION_EXPIRED',
  GRACE_PERIOD_EXPIRED:       'GRACE_PERIOD_EXPIRED',
  SEAT_LIMIT_REACHED:         'SEAT_LIMIT_REACHED',
  FEATURE_NOT_AVAILABLE:      'FEATURE_NOT_AVAILABLE',
  QUOTA_EXCEEDED:             'QUOTA_EXCEEDED',

  // Rate limiting
  RATE_LIMIT_EXCEEDED:        'RATE_LIMIT_EXCEEDED',

  // Resources
  NOT_FOUND:                  'NOT_FOUND',
  CONFLICT:                   'CONFLICT',
  /** The module or plugin behind a selected provider is not active for this tenant (docs/phases/37-extensions). */
  PROVIDER_UNAVAILABLE:       'PROVIDER_UNAVAILABLE',
  CART_PRICE_CHANGED:         'CART_PRICE_CHANGED',
  CART_BELOW_MINIMUM:         'CART_BELOW_MINIMUM',
  CART_LIMIT_EXCEEDED:        'CART_LIMIT_EXCEEDED',
  CART_ITEM_UNAVAILABLE:      'CART_ITEM_UNAVAILABLE',
  VALIDATION_ERROR:           'VALIDATION_ERROR',

  // Internationalization & Jurisdiction
  UNSUPPORTED_CURRENCY:       'UNSUPPORTED_CURRENCY',
  UNSUPPORTED_LOCALE:         'UNSUPPORTED_LOCALE',
  UNSUPPORTED_TIMEZONE:       'UNSUPPORTED_TIMEZONE',
  COUNTRY_RESTRICTED:         'COUNTRY_RESTRICTED',
  TAX_JURISDICTION_ERROR:     'TAX_JURISDICTION_ERROR',
  CURRENCY_MISMATCH:          'CURRENCY_MISMATCH',

  // Server
  INTERNAL_ERROR:             'INTERNAL_ERROR',
} as const;

export type ErrorCode = typeof ErrorCode[keyof typeof ErrorCode];

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  /** Optional HTTP headers to attach to the normalized error response (e.g. rate-limit `Retry-After`). */
  readonly headers?: Record<string, string>;
  /**
   * Optional machine-readable detail the client needs to act on the error
   * (e.g. the old/new prices of a `CART_PRICE_CHANGED`). Serialized as-is, so
   * only put in it what the caller is allowed to see.
   */
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    public readonly statusCode: number = 500,
    code: ErrorCode = ErrorCode.INTERNAL_ERROR,
    options?: { retryable?: boolean; headers?: Record<string, string>; details?: Record<string, unknown> },
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.retryable = options?.retryable ?? false;
    this.headers = options?.headers;
    this.details = options?.details;
  }

  toJSON(): { code: ErrorCode; message: string; retryable: boolean } {
    return { code: this.code, message: this.message, retryable: this.retryable };
  }
}

export function toErrorResponse(error: unknown): { code: string; message: string } {
  if (error instanceof AppError) return error.toJSON();
  if (error instanceof Error) return { code: ErrorCode.INTERNAL_ERROR, message: error.message };
  return { code: ErrorCode.INTERNAL_ERROR, message: 'An unexpected error occurred' };
}

/** Resolve the HTTP status code for any thrown value (`AppError` → its status, else 500). */
export function statusCodeFor(error: unknown): number {
  return error instanceof AppError ? error.statusCode : 500;
}

/** Whether a thrown value is safe to retry (`AppError.retryable`, else false). */
export function isRetryable(error: unknown): boolean {
  return error instanceof AppError ? error.retryable : false;
}
