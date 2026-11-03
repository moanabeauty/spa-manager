import { getCurrentUser } from "@/lib/supabase/server";
import { PRODUCT_COLUMNS, canManageStock, fetchDefaultDiscountPct, type Product } from "@/lib/inventory";
import { KhoNav } from "../shared";
import ProductEditor from "./ProductEditor";

export const metadata = { title: "Sản phẩm – Moana Beauty" };

export default async function ProductsPage() {
  const { supabase, profile } = await getCurrentUser();
  if (!canManageStock(profile?.role)) {
    return <p className="card text-sm">Chỉ quản lý kho, quản lý và chủ spa được sửa danh mục sản phẩm.</p>;
  }
  const [{ data: products }, { data: costs }, pct] = await Promise.all([
    supabase.from("products").select(PRODUCT_COLUMNS).order("name"),
    supabase.rpc("product_costs"),
    fetchDefaultDiscountPct(supabase),
  ]);
  const costMap = Object.fromEntries(((costs ?? []) as { product_id: string; cost_price: number | null }[]).map((c) => [c.product_id, c.cost_price]));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-navy">Sản phẩm</h1>
        <p className="text-sm text-ink/70">Danh mục dùng chung cho cả 2 chi nhánh. Mỗi sản phẩm luôn có nhãn hàng, tên, dung tích.</p>
      </div>
      <KhoNav active="sp" role={profile!.role} />
      <ProductEditor products={(products ?? []) as Product[]} costs={costMap} defaultPct={pct} isOwner={profile?.role === "owner"} />
    </div>
  );
}
