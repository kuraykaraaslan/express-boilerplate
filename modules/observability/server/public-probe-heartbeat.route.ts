import { signedRunnerHandler } from './probe.runner.http'
import ProbeRunnerService from './probe.runner.service'
import { RunnerHeartbeatDTO } from './probe.dto'

/** POST /api/public/probe/heartbeat — a signed runner says it is alive (and which version it is). */
export const POST = signedRunnerHandler('/heartbeat', async (runner, body) => {
  const dto = RunnerHeartbeatDTO.parse(body)
  await ProbeRunnerService.heartbeat(runner, dto.version ?? null, new Date(), dto.capabilities)
  return { ok: true }
})
