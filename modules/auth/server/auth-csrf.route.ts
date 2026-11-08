import Logger from '@kuraykaraaslan-labs/logger';
import { env } from '@kuraykaraaslan-labs/env';
import { NextResponse, type NextRequest } from 'next/server';
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  CSRF_TOKEN_EXPIRY_SECONDS,
  generateCsrfToken,
  requestCsrfBinding,
} from '@kuraykaraaslan-labs/common/server/csrf';

export async function GET(request: NextRequest) {
  try {
    // Signed double-submit token. Generation + verification live in one module
    // (@kuraykaraaslan-labs/common/server/csrf) so the issuer here and the central
    // verifier in the tenant API dispatcher can never disagree on the format.
    // common.15: bound to the session this request carries (none before login), so the client mints again after login,
    // refresh and a tenant switch.
    const token = generateCsrfToken(requestCsrfBinding(request));
    const isProduction = env.NODE_ENV === 'production';

    const response = NextResponse.json({
      success: true,
      data: {
        token,
        headerName: CSRF_HEADER_NAME,
        expiresIn: CSRF_TOKEN_EXPIRY_SECONDS,
      },
    });

    response.cookies.set(CSRF_COOKIE_NAME, token, {
      httpOnly: false, // must be readable by the client to echo into the header
      secure: isProduction,
      sameSite: 'strict',
      path: '/',
      maxAge: CSRF_TOKEN_EXPIRY_SECONDS,
    });

    return response;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to generate CSRF token';
    Logger.error('[CSRF] Token generation error:', errorMessage);

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'CSRF_ERROR',
          message: 'Failed to generate CSRF token',
        },
      },
      { status: 500 }
    );
  }
}
