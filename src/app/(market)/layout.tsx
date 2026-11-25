import type { ReactNode } from "react";
import { MarketShell } from "@/components/market-shell";
import { getViewer } from "@/features/auth/identity";

export default async function MarketplaceLayout({ children }: { children: ReactNode }) {
  const viewer = await getViewer();
  return <MarketShell key={viewer?.id ?? "guest"} viewer={viewer}>{children}</MarketShell>;
}
