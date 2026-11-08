import crypto from "crypto";
import { NextRequest } from 'next/server';
import { FINGERPRINT_INCLUDES_IP } from './user_session.token.service';

export default class UserSessionNextHelpers {

  /**
   * Generates a device fingerprint based on the request headers.
   *
   * The IP is only part of it in production — see FINGERPRINT_INCLUDES_IP for
   * why a dev machine's shifting address must not invalidate the session.
   *
   * @param request - The HTTP request object.
   * @returns A promise that resolves to the device fingerprint.
   */
  static generateDeviceFingerprint(request: NextRequest): string {
    const ip = !FINGERPRINT_INCLUDES_IP ? "" :
               request.headers.get("x-forwarded-for") ||
               request.headers.get("x-real-ip") ||
               request.headers.get("cf-connecting-ip") ||
               request.headers.get("remote-addr") ||
               request.headers.get("x-client-ip") ||
               request.headers.get("x-cluster-client-ip") ||
               request.headers.get("x-original-forwarded-for") ||
               request.headers.get("forwarded-for") ||
               request.headers.get("forwarded");
    const userAgent = request.headers.get("user-agent") || "";
    const acceptLanguage = request.headers.get("accept-language") || "";

    const rawFingerprint = `${ip}|${userAgent}|${acceptLanguage}`;
    return crypto.createHash("sha256").update(rawFingerprint).digest("hex");
  }
}
