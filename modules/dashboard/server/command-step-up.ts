/**
 * The request header that carries a step-up grant (phase 35.2), the platform's own name for it (`auth/server/auth.step-up.ts`
 * `STEP_UP_HEADER`, `auth/ui/step-up.client.ts`). Kept here as a plain constant so the run route can tell "no grant yet" (the
 * first leg of the exchange, not audited) from "a grant that was refused" without loading `auth` for every command.
 */
export const STEP_UP_HEADER = 'x-step-up-token'
