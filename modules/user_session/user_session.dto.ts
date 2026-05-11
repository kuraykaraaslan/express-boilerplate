import { z } from 'zod';

export const GetSessionDTO = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
});

export type GetSessionInput = z.infer<typeof GetSessionDTO>;

export const RefreshTokenDTO = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export type RefreshTokenInput = z.infer<typeof RefreshTokenDTO>;

export const CreateSessionDTO = z.object({
  userId: z.string().uuid('User ID must be a valid UUID'),
});

export type CreateSessionInput = z.infer<typeof CreateSessionDTO>;
