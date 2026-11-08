import { heartbeatHandlers } from './uptime.heartbeat.route-factory'
export const { GET, POST } = heartbeatHandlers('start')
