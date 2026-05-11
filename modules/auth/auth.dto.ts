import { z } from 'zod';
import { OTPMethodEnum } from '@/modules/user/user.enums';

export const LoginDTO = z.object({
  email: z.string().email('Email must be valid'),
  password: z.string().min(1, 'Password is required'),
});

export type LoginInput = z.infer<typeof LoginDTO>;

export const RegisterDTO = z.object({
  email: z.string().email('Email must be valid'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().optional(),
  phone: z.string().optional(),
});

export type RegisterInput = z.infer<typeof RegisterDTO>;

export const ForgotPasswordDTO = z.object({
  email: z.string().email('Email must be valid'),
});

export type ForgotPasswordInput = z.infer<typeof ForgotPasswordDTO>;

export const ResetPasswordDTO = z.object({
  token: z.string().min(1, 'Token is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  email: z.string().email().optional(),
});

export type ResetPasswordInput = z.infer<typeof ResetPasswordDTO>;

export const VerifyEmailDTO = z.object({
  token: z.string().min(1, 'Token is required'),
  userId: z.string().uuid('User ID must be a valid UUID'),
});

export type VerifyEmailInput = z.infer<typeof VerifyEmailDTO>;

export const OTPSendDTO = z.object({
  method: OTPMethodEnum,
});

export type OTPSendInput = z.infer<typeof OTPSendDTO>;

export const OTPVerifyDTO = z.object({
  otp: z.string().length(6, 'OTP must be 6 characters'),
  method: OTPMethodEnum,
});

export type OTPVerifyInput = z.infer<typeof OTPVerifyDTO>;
