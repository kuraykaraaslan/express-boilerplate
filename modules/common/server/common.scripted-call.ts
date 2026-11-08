import { ext, tenantCtx } from './extensions/ext'
import { commonScriptedCallLoaders } from './generated/extensions/common.scripted_call'

/**
 * Where a lower-edition module asks for an automated phone call that reads a text and waits for a key press. `on_call` pages people by voice,
 * but `telephony` is an Enterprise module and a Core module may not import a higher edition (ADR-0001, phase 35/02). `telephony` contributes the
 * service (`telephony/server/telephony.scripted-call`); without it, or with it switched off for the tenant, the voice channel is unavailable and the
 * engine skips to the next method.
 *
 * Hosted by `common`: `on_call` already contributes to telephony's `telephony:scripted_call_handler` and `telephony:call_completed`, so a contribution
 * from telephony into an on_call point would be a contribution cycle, which the registry refuses (the `common:price_resolver` precedent).
 * Declared in common/module.json `extensionPoints`.
 */
export const SCRIPTED_CALL_POINT = 'common:scripted_call'

/** The scripted-call service as a caller sees it (telephony's `TelephonyScriptedCallService` satisfies it structurally). */
export interface ScriptedCallApi {
  available(tenantId: string): Promise<boolean>
  place(req: {
    tenantId: string; to: string; text: string
    handler: { key: string; token: string }
    party: { type: string; id: string }
    idempotencyKey?: string
  }): Promise<{ callId: string; providerCallRef: string; deduplicated: boolean }>
}

/** The tenant's contributed service, or `null` when no module active for the tenant provides one. */
export async function loadScriptedCallApi(tenantId: string): Promise<ScriptedCallApi | null> {
  const found = await ext.first<ScriptedCallApi, ScriptedCallApi>(
    SCRIPTED_CALL_POINT, tenantCtx(tenantId), commonScriptedCallLoaders, (api) => api,
  )
  return found?.value ?? null
}
