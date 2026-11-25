"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState, type ComponentProps, type ReactNode } from "react";
import { useForm, type UseFormRegisterReturn } from "react-hook-form";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { loginWithPassword, openShop, registerAccount, saveNewPassword, sendRecoveryEmail, startGoogleLogin, updateProfile } from "./actions";
import { loginPath } from "./redirects";
import { forgotSchema, loginSchema, onboardingSchema, profileSchema, registerSchema, updatePasswordSchema } from "./schemas";
import { useT } from "@/components/preferences";
import { localAdminEnabled } from "./local-admin";

type ActionResult = Awaited<ReturnType<typeof loginWithPassword>>;

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function run(action: () => Promise<ActionResult>, onSuccess?: () => void) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await action();
      if ("error" in result) { setError(result.error); return; }
      if (result.redirect) { window.location.assign(result.redirect); return; }
      setMessage(result.message ?? "");
      onSuccess?.();
    } catch {
      setError("Không thể hoàn tất yêu cầu. Vui lòng thử lại.");
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, message, run };
}

function Feedback({ error, message }: { error: string; message: string }) {
  const t = useT();
  return <>{error && <p role="alert" className="auth-feedback auth-error">{t(error)}</p>}
    {message && <p role="status" className="auth-feedback">{t(message)}</p>}</>;
}

function Field({ label, field, error, multiline, ...props }: ComponentProps<"input"> & {
  label: string; field: UseFormRegisterReturn; error?: string; multiline?: boolean;
}) {
  const t = useT();
  const id = "field-" + field.name;
  const accessibility = { id, "aria-invalid": Boolean(error), "aria-describedby": error ? id + "-error" : undefined };
  return <div className="auth-field">
    <label htmlFor={id}>{label}</label>
    {multiline ? <textarea {...field} {...accessibility} rows={4} maxLength={props.maxLength} />
      : <input {...props} {...field} {...accessibility} />}
    {error && <p id={id + "-error"} className="auth-error">{t(error)}</p>}
  </div>;
}

export function AuthCard({ title, description, children, footer }: {
  title: string; description?: string; children: ReactNode; footer?: ReactNode;
}) {
  return <section className="market-panel account-panel auth-card">
    <h1>{title}</h1>
    {description && <p className="muted">{description}</p>}
    {children}
    {footer && <div className="auth-footer">{footer}</div>}
  </section>;
}

export function LoginForm({ destination, notice }: { destination: string; notice?: string }) {
  const t = useT();
  const form = useForm({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });
  const submit = useSubmit();
  const registerPath = "/register?" + new URLSearchParams({ redirect: destination }).toString();
  return <AuthCard title={t("Đăng nhập")} footer={<p>{t("Chưa có tài khoản?") + " "}<Link href={registerPath}>{t("Đăng ký")}</Link></p>}>
    {notice && <p className="auth-feedback" role="status">{t(notice)}</p>}
    <form method="post" className="market-form auth-form" noValidate onSubmit={form.handleSubmit((values) => submit.run(() => loginWithPassword(values, destination)))}>
      <Field type={localAdminEnabled ? "text" : "email"} label={localAdminEnabled ? t("Email hoặc tên đăng nhập") : "Email"}
        field={form.register("email")} error={form.formState.errors.email?.message} autoComplete="username" autoCapitalize="none" />
      <Field type="password" label={t("Mật khẩu")} field={form.register("password")} error={form.formState.errors.password?.message} autoComplete="current-password" />
      <Link className="auth-text-link" href="/forgot-password">{t("Quên mật khẩu?")}</Link>
      <Button disabled={submit.busy}>{t("Đăng nhập")}</Button>
      <Button type="button" variant="outline" disabled={submit.busy} onClick={() => void submit.run(() => startGoogleLogin(destination))}>{t("Tiếp tục với Google")}</Button>
    </form>
    <Feedback {...submit} />
  </AuthCard>;
}

export function RegisterForm({ destination }: { destination: string }) {
  const t = useT();
  const form = useForm({ resolver: zodResolver(registerSchema), defaultValues: { name: "", email: "", password: "" } });
  const submit = useSubmit();
  return <AuthCard title={t("Đăng ký")} footer={<p>{t("Đã có tài khoản?") + " "}<Link href={loginPath(destination)}>{t("Đăng nhập")}</Link></p>}>
    {submit.message ? <Feedback {...submit} /> : <form method="post" className="market-form auth-form" noValidate
      onSubmit={form.handleSubmit((values) => submit.run(() => registerAccount(values, destination)))}>
      <Field label={t("Họ và tên")} field={form.register("name")} error={form.formState.errors.name?.message} autoComplete="name" maxLength={100} />
      <Field type="email" label="Email" field={form.register("email")} error={form.formState.errors.email?.message} autoComplete="email" />
      <Field type="password" label={t("Mật khẩu (ít nhất 8 ký tự)")} field={form.register("password")} error={form.formState.errors.password?.message} autoComplete="new-password" />
      <Button disabled={submit.busy}>{t("Tạo tài khoản")}</Button>
      <Feedback {...submit} />
    </form>}
  </AuthCard>;
}

export function ForgotForm({ expired }: { expired: boolean }) {
  const t = useT();
  const form = useForm({ resolver: zodResolver(forgotSchema), defaultValues: { email: "" } });
  const submit = useSubmit();
  return <AuthCard title={t("Quên mật khẩu")} description={t("Nhập email của tài khoản để nhận liên kết đặt lại mật khẩu.")}
    footer={<Link href="/login">{t("Quay về đăng nhập")}</Link>}>
    {expired && !submit.message && <p className="auth-feedback" role="status">{t("Liên kết đã hết hạn hoặc đã được sử dụng. Hãy yêu cầu liên kết mới.")}</p>}
    {submit.message ? <Feedback {...submit} /> : <form method="post" className="market-form auth-form" noValidate
      onSubmit={form.handleSubmit((values) => submit.run(() => sendRecoveryEmail(values)))}>
      <Field type="email" label="Email" field={form.register("email")} error={form.formState.errors.email?.message} autoComplete="email" />
      <Button disabled={submit.busy}>{t("Gửi liên kết")}</Button>
      <Feedback {...submit} />
    </form>}
  </AuthCard>;
}

export function UpdatePasswordForm() {
  const t = useT();
  const form = useForm({ resolver: zodResolver(updatePasswordSchema), defaultValues: { password: "", confirmation: "" } });
  const submit = useSubmit();
  return <AuthCard title={t("Đặt mật khẩu mới")} footer={<Link href="/forgot-password">{t("Yêu cầu liên kết mới")}</Link>}>
    <form method="post" className="market-form auth-form" noValidate onSubmit={form.handleSubmit((values) => submit.run(() => saveNewPassword(values)))}>
      <Field type="password" label={t("Mật khẩu mới (ít nhất 8 ký tự)")} field={form.register("password")}
        error={form.formState.errors.password?.message} autoComplete="new-password" />
      <Field type="password" label={t("Nhập lại mật khẩu")} field={form.register("confirmation")}
        error={form.formState.errors.confirmation?.message} autoComplete="new-password" />
      <Button disabled={submit.busy}>{t("Cập nhật mật khẩu")}</Button>
      <Feedback {...submit} />
    </form>
  </AuthCard>;
}

export function OnboardingForm() {
  const t = useT();
  const form = useForm({ resolver: zodResolver(onboardingSchema),
    defaultValues: { name: "", slug: "", description: "", warehouseAddress: "", phone: "" } });
  const submit = useSubmit();
  return <section className="market-panel onboarding-panel">
    <h1>{t("Đăng ký mở shop")}</h1>
    <p className="muted">{t("Bạn có thể chuẩn bị sản phẩm sau khi lập shop. Shop xuất hiện trên sàn sau khi được duyệt.")}</p>
    <form method="post" className="market-form auth-form" noValidate onSubmit={form.handleSubmit((values) => submit.run(() => openShop(values)))}>
      <div className="market-fields">
        <Field label={t("Tên shop")} field={form.register("name")} error={form.formState.errors.name?.message} autoComplete="organization" maxLength={160} />
        <Field label={t("Slug đường dẫn")} placeholder="goc-lam-viec" field={form.register("slug")}
          error={form.formState.errors.slug?.message} maxLength={100} autoCapitalize="none" />
      </div>
      <Field label={t("Mô tả shop")} multiline maxLength={2000} field={form.register("description")} error={form.formState.errors.description?.message} />
      <Field label={t("Địa chỉ kho hàng")} field={form.register("warehouseAddress")} error={form.formState.errors.warehouseAddress?.message}
        maxLength={500} autoComplete="street-address" />
      <Field label={t("Số điện thoại")} type="tel" field={form.register("phone")} error={form.formState.errors.phone?.message}
        maxLength={25} autoComplete="tel" />
      <Button disabled={submit.busy}>{t("Tạo shop")}</Button>
      <Feedback {...submit} />
    </form>
  </section>;
}

export function ProfileForm({ name }: { name: string }) {
  const t = useT();
  const router = useRouter();
  const form = useForm({ resolver: zodResolver(profileSchema), defaultValues: { name } });
  const submit = useSubmit();
  return <form method="post" className="market-form auth-form" noValidate onSubmit={form.handleSubmit((values) =>
    submit.run(() => updateProfile(values), () => router.refresh()))}>
    <Field label={t("Họ và tên")} field={form.register("name")} error={form.formState.errors.name?.message} autoComplete="name" maxLength={100} />
    <Button disabled={submit.busy}>{t("Lưu hồ sơ")}</Button>
    <Feedback {...submit} />
  </form>;
}
