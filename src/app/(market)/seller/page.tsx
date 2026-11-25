import { SellerMarket } from "@/features/seller/seller-market";
import { requireViewer } from "@/features/auth/identity";
import { redirect } from "next/navigation";

export default async function SellerPage() {
  const viewer = await requireViewer("/seller");
  if (viewer?.role === "buyer") redirect("/seller/onboarding");
  return <SellerMarket />;
}
