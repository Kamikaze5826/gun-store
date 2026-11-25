import { Storefront } from "@/features/catalog/storefront";
import { getModelListings } from "@/features/catalog/model-listings";
import { getViewer } from "@/features/auth/identity";
import { isSupabaseConfigured } from "@/utils/supabase/config";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const demo = (await searchParams).mode === "demo";
  const [products, viewer] = await Promise.all([demo ? [] : getModelListings(), getViewer()]);
  return <Storefront products={products} viewer={viewer} accountEnabled={isSupabaseConfigured} />;
}
