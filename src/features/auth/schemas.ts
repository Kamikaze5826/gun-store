import { z } from "zod";
import { isAdminUsername, localAdminEnabled } from "./local-admin";

const email = z.string().trim().max(254, "Email quá dài.").pipe(z.email("Nhập địa chỉ email hợp lệ."));
const password = z.string().min(8, "Mật khẩu cần ít nhất 8 ký tự.")
  .refine((value) => new TextEncoder().encode(value).length <= 72, "Mật khẩu quá dài.");

export const profileSchema = z.object({
  name: z.string().trim().min(2, "Nhập họ tên từ 2 ký tự.").max(100, "Họ tên tối đa 100 ký tự."),
});
export const loginSchema = z.object({
  email: z.string().trim().refine((value) => email.safeParse(value).success ||
    (localAdminEnabled && isAdminUsername(value)), "Nhập địa chỉ email hợp lệ."),
  password: z.string().min(1, "Nhập mật khẩu.").max(256, "Mật khẩu quá dài."),
});
export const registerSchema = profileSchema.extend({ email, password });
export const forgotSchema = z.object({ email });
export const updatePasswordSchema = z.object({ password, confirmation: z.string() }).refine(
  ({ password, confirmation }) => password === confirmation,
  { path: ["confirmation"], message: "Hai mật khẩu chưa khớp." },
);
export const onboardingSchema = z.object({
  name: z.string().trim().min(2, "Nhập tên shop từ 2 ký tự.").max(160, "Tên shop tối đa 160 ký tự."),
  slug: z.string().trim().toLowerCase().max(100, "Slug tối đa 100 ký tự.")
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Slug chỉ dùng chữ không dấu, số và dấu gạch ngang giữa các từ."),
  description: z.string().trim().max(2000, "Mô tả tối đa 2.000 ký tự."),
  warehouseAddress: z.string().trim().min(5, "Nhập địa chỉ kho đầy đủ.").max(500, "Địa chỉ tối đa 500 ký tự."),
  phone: z.string().trim().regex(/^\+?[0-9][0-9 ()-]{6,23}$/, "Nhập số điện thoại hợp lệ.")
    .refine((value) => { const digits = value.replace(/\D/g, "").length; return digits >= 7 && digits <= 15; },
      "Số điện thoại cần từ 7 đến 15 chữ số."),
});
