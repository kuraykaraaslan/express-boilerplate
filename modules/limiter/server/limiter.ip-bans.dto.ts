import { z } from 'zod';
import { BAN_TARGET_MAX_LENGTH } from './limiter.ban-target';

/** The longest manual ban, minutes: the strike store's cap (BAN_MAX_SECONDS, seven days). Longer belongs in the global blocklist. */
export const IP_BAN_MAX_MINUTES = 7 * 24 * 60;
export const IP_BAN_REASON_MAX = 200;

/** POST /api/limiter/ip-bans: ban an address or CIDR block for a while, with the reason the audit row and the ban list show. */
export const IpBanCreateDTO = z.object({
  target: z.string().trim().min(1).max(BAN_TARGET_MAX_LENGTH),
  reason: z.string().trim().min(1).max(IP_BAN_REASON_MAX),
  minutes: z.number().int().min(1).max(IP_BAN_MAX_MINUTES),
}).strict();
export type IpBanCreateInput = z.infer<typeof IpBanCreateDTO>;

/** DELETE /api/limiter/ip-bans?target=: lift the ban on an address or CIDR block (as the ban list names it). */
export const IpBanLiftQueryDTO = z.object({
  target: z.string().trim().min(1).max(BAN_TARGET_MAX_LENGTH),
});
