import { redirect } from "next/navigation";
import { OnboardingForm } from "@/features/auth/forms";
import { requireViewer } from "@/features/auth/identity";

export default async function SellerOnboardingPage() {
  const viewer = await requireViewer("/seller/onboarding");
  if (!viewer) return null;
  if (viewer.role !== "buyer") redirect(viewer.role === "admin" ? "/admin" : "/seller");
  return <OnboardingForm />;
}
