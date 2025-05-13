import { z } from "zod";
import { PhoneNumberUtil } from "google-libphonenumber";

export const RegisterRequest = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  phone: z.string().optional(),
  name: z.string().optional(),
}).refine((data) => {
  if (!data.phone) return true;

  const phoneUtil = PhoneNumberUtil.getInstance();
  try {
    const number = phoneUtil.parse(data.phone, "US");
    return phoneUtil.isValidNumber(number);
  } catch {
    return false;
  }
}, {
  message: "INVALID_PHONE_NUMBER",
  path: ["phone"], // ❗️ Böylece hata "phone" alanına bağlanır
});

export type RegisterRequest = z.infer<typeof RegisterRequest>;
