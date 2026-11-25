import { redirect } from "next/navigation";
import { getViewer } from "@/features/auth/identity";

export default async function AccountPage() {
  redirect(await getViewer() ? "/profile" : "/login");
}
