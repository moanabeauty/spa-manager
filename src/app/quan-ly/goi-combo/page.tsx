import { getCurrentUser } from "@/lib/supabase/server";
import PackageEditor, { type Pkg } from "./PackageEditor";

export const metadata = { title: "Gói combo – Moana Beauty" };

export default async function PackagesPage() {
  const { supabase, profile } = await getCurrentUser();
  if (profile?.role !== "owner" && profile?.role !== "manager") {
    return <p className="card text-sm">Chỉ chủ spa và quản lý được sửa gói combo.</p>;
  }
  const [{ data: packages }, { data: services }] = await Promise.all([
    supabase
      .from("packages")
      .select("id, name, description, price, validity_days, is_active, package_services(service_id, quantity)")
      .order("is_active", { ascending: false })
      .order("name"),
    supabase.from("services").select("id, name, name_en, price, is_active").eq("is_active", true).order("name"),
  ]);
  return (
    <PackageEditor
      packages={(packages ?? []) as Pkg[]}
      services={(services ?? []) as { id: string; name: string; name_en: string | null; price: number | null }[]}
    />
  );
}
