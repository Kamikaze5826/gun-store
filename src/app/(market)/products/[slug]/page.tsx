import { ProductMarket } from "@/features/catalog/product-market";

export default async function ProductPage({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<{ shop?: string | string[] }>;
}) {
  const [{ slug }, { shop }] = await Promise.all([params, searchParams]);
  return <ProductMarket slug={slug} shop={typeof shop === "string" ? shop : undefined} />;
}
