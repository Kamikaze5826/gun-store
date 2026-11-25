import { redirect } from "next/navigation";
import { RegisterForm } from "@/features/auth/forms";
import { getViewer } from "@/features/auth/identity";
import { safeRedirect } from "@/features/auth/redirects";

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ redirect?: string | string[] }> }) {
  const { redirect: requested } = await searchParams;
  const destination = safeRedirect(typeof requested === "string" ? requested : undefined);
  if (await getViewer()) redirect(destination);
  return <RegisterForm destination={destination} />;
}
