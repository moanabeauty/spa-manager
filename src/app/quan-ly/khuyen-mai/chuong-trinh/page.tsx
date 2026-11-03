import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import { PROMO_SELECT, fetchTakenCounts, type Promotion } from "@/lib/promotions";
import PromotionEditor, { type Pickable } from "./PromotionEditor";

export const metadata = { title: "Chương trình khuyến mãi – Moana Beauty" };

export default async function PromotionProgramsPage() {
  const { supabase, profile } = await getCurrentUser();
  if (profile?.role !== "owner" && profile?.role !== "manager") {
    return <p className="card text-sm">Chỉ chủ spa và quản lý được tạo, sửa khuyến mãi.</p>;
  }
  const [{ data: promos }, { data: branches }, { data: services }, { data: packages }, { data: products }, taken] = await Promise.all([
    supabase.from("promotions").select(PROMO_SELECT).order("is_active", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
    supabase.from("services").select("id, name, name_en, price").eq("is_active", true).order("name"),
    supabase.from("packages").select("id, name, price, is_active").order("name"),
    supabase.from("products").select("id, name, brand, capacity, retail_price").eq("is_active", true).eq("for_retail", true).not("retail_price", "is", null).order("name"),
    fetchTakenCounts(supabase),
  ]);

  const pickables: Pickable[] = [
    ...((services ?? []) as { id: string; name: string; name_en: string | null; price: number | null }[]).map((s) => ({
      type: "service" as const,
      id: s.id,
      label: s.name,
      search: `${s.name} ${s.name_en ?? ""}`,
      price: s.price === null ? null : Number(s.price),
      note: "dịch vụ",
    })),
    ...((packages ?? []) as { id: string; name: string; price: number; is_active: boolean }[]).map((p) => ({
      type: "package" as const,
      id: p.id,
      label: `Gói ${p.name}`,
      search: `goi combo ${p.name}`,
      price: Number(p.price),
      note: p.is_active ? "gói combo" : "gói ngừng bán (chỉ bán qua KM)",
    })),
    ...((products ?? []) as { id: string; name: string; brand: string | null; capacity: string | null; retail_price: number }[]).map((p) => ({
      type: "product" as const,
      id: p.id,
      label: [p.name, p.capacity].filter(Boolean).join(" "),
      search: `${p.brand ?? ""} ${p.name} ${p.capacity ?? ""} san pham`,
      price: Number(p.retail_price),
      note: p.brand ? `sản phẩm · ${p.brand}` : "sản phẩm",
    })),
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm">
        <Link href="/quan-ly/khuyen-mai" className="text-navy underline">← Đăng ký khuyến mãi</Link>
      </p>
      <PromotionEditor
        promotions={(promos ?? []) as unknown as Promotion[]}
        branches={(branches ?? []) as { id: string; name: string }[]}
        pickables={pickables}
        taken={Object.fromEntries(taken)}
      />
    </div>
  );
}
