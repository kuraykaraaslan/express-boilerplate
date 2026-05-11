import { z } from 'zod';

export const InvitationStatusEnum = z.enum([
  'PENDING',
  'ACCEPTED',
  'DECLINED',
  'EXPIRED',
]);

export type InvitationStatus = z.infer<typeof InvitationStatusEnum>;
