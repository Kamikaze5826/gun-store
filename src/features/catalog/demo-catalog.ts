import catalog from "./model-catalog.json";

export const categories = [{ slug: "", name: "Tất cả" }, ...catalog.categories];

export type Product = {
  id: string;
  name: string;
  shop: string;
  category: string;
  categoryName: string;
  price: number;
  image: string;
  description: string;
  material: string;
};

export const demoProducts: Product[] = catalog.products.map((product) => ({
  id: product.id, name: product.name, price: product.price, description: product.description, material: product.material,
  category: product.category, categoryName: catalog.categories.find((item) => item.slug === product.category)?.name ?? "",
  shop: catalog.shopName, image: "/marketplace/models/" + product.photo,
}));

export function normalizeSearch(value: string) {
  return value.toLocaleLowerCase("vi").normalize("NFD").replace(/\p{M}/gu, "").replaceAll("đ", "d");
}

export function searchCatalog<T extends Product>(products: T[], category: string, search: string, sort: string, translate = (value: string) => value) {
  const terms = normalizeSearch(search).trim().split(/\s+/).filter(Boolean);
  const visible = products.filter((product) => {
    const searchable = normalizeSearch(`${product.name} ${product.material} ${product.categoryName} ${translate(product.name)} ${translate(product.categoryName)}`);
    return (!category || product.category === category) && terms.every((term) => searchable.includes(term));
  });
  if (sort === "price-asc") return visible.sort((a, b) => a.price - b.price);
  if (sort === "price-desc") return visible.sort((a, b) => b.price - a.price);
  return visible;
}
