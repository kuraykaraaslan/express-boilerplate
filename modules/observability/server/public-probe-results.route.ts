import { signedRunnerHandler, MAX_RESULT_BODY_BYTES } from './probe.runner.http'
import ProbeLeaseService from './probe.lease.service'

/** POST /api/public/probe/results — a signed runner posts the result of one lease (idempotent on the lease id). */
export const POST = signedRunnerHandler('/results', async (runner, body) => ProbeLeaseService.acceptResult(runner, body), { maxBytes: MAX_RESULT_BODY_BYTES })
