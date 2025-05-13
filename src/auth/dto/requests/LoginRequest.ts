import { z } from "zod";

export const LoginRequest = z.object({
  email: z.string({ required_error: "Email is required" })
          .email("Email must be valid"),
  
  password: z.string({ required_error: "Password is required" })
            .min(8, "Password must be at least 8 characters"),
});

export type LoginRequest = z.infer<typeof LoginRequest>;
