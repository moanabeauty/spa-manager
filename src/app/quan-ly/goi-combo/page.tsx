import { getCurrentUser } from "@/lib/supabase/server";
import PackageEditor, { type Pkg } from "./PackageEditor";

export const metadata = { title: "Gói combo – Moana Beauty" };

export default async function PackagesPage() {
  const { supabase, profile } = await getCurrentUser();
  if (profile?.role !== "owner" && profile?.role !== "manager") {
    return <p className="card text-sm">Chỉ chủ spa và quản lý được sửa gói combo.</p>;
  }
  const [{ data: packages }, { data: services }, { data: notes }] = await Promise.all([
    supabase
      .from("packages")
      .select("id, name, description, price, validity_days, is_active, category, sort_order, package_items(id, label, quantity, unit_price, sort_order, package_item_services(service_id))")
      .order("is_active", { ascending: false })
      .order("sort_order")
      .order("name"),
    supabase.from("services").select("id, name, name_en, price, is_active").eq("is_active", true).order("name_en"),
    supabase.from("package_item_notes").select("item_id, note"),
  ]);
  const noteById = new Map(((notes ?? []) as { item_id: string; note: string }[]).map((n) => [n.item_id, n.note]));
  const rows = ((packages ?? []) as Pkg[]).map((p) => ({
    ...p,
    package_items: p.package_items.map((i) => ({ ...i, note: noteById.get(i.id) ?? null })),
  }));
  return (
    <PackageEditor
      packages={rows}
      services={(services ?? []) as { id: string; name: string; name_en: string | null; price: number | null }[]}
    />
  );
}
