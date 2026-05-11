import { z } from 'zod';
import { OTPMethodEnum } from './user_security.enums';

// ============================================================================
// Update OTP Methods DTO
// ============================================================================

export const UpdateOTPMethodsDTO = z.object({
  methods: z.array(OTPMethodEnum),
});

export type UpdateOTPMethodsInput = z.infer<typeof UpdateOTPMethodsDTO>;

// ============================================================================
// Get User Security DTO
// ============================================================================

export const GetUserSecurityDTO = z.object({
  userId: z.string().uuid(),
});

export type GetUserSecurityInput = z.infer<typeof GetUserSecurityDTO>;
