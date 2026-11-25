import { ForgotForm } from "@/features/auth/forms";

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  return <ForgotForm expired={(await searchParams).notice === "link-expired"} />;
}
