import type { RequestPrincipal } from '@kuraykaraaslan-labs/common/server/request-observer';

/**
 * Phase 55 02 §2.1: who the guard authenticated, as the AI firewall's feature store notes it beside the request (ids and the member's
 * role, never a token; common/server/request-observer.ts). Pure; null for a guest without a user or an unreadable result.
 *
 * During an impersonation (D55-47) the caller is the OPERATOR, never the person impersonated: what an operator does in somebody's name
 * must not fold into that person's windows, day profile or baseline, nor make a detection or an incident name them. The operator is
 * noted without a session and without a role (the session and the role belong to the impersonation, not to the operator's own
 * membership) and flagged `impersonating`, so the fold keeps the request out of every day profile. An impersonation whose operator is
 * not known notes nothing (the address alone).
 */
export function principalOfAuthResult(result: unknown): RequestPrincipal | null {
  try {
    const r = result as {
      user?: { userId?: string } | null;
      apiKey?: { apiKeyId?: string } | null;
      userSession?: { userSessionId?: string } | null;
      tenantMember?: { memberRole?: string } | null;
      tenant?: { tenantId?: string } | null;
      isImpersonating?: boolean;
      impersonatedBy?: { userId?: string } | null;
    } | null | undefined;
    const userId = r?.user?.userId;
    if (!r || !userId) return null;
    const tenantId = r.tenant?.tenantId ?? null;
    if (r.isImpersonating) {
      const operator = r.impersonatedBy?.userId;
      if (!operator) return null;
      return { userId: operator, sessionId: null, apiKeyId: null, role: null, tenantId, impersonating: true };
    }
    return {
      userId,
      sessionId: r.apiKey ? null : r.userSession?.userSessionId ?? null,
      apiKeyId: r.apiKey?.apiKeyId ?? null,
      role: r.tenantMember?.memberRole ?? null,
      tenantId,
    };
  } catch {
    return null;
  }
}
