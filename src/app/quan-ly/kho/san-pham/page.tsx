import { getCurrentUser, isStaffRole } from "@/lib/supabase/server";
import { PRODUCT_COLUMNS, canManageStock, fetchDefaultDiscountPct, type Product } from "@/lib/inventory";
import ProductEditor from "./ProductEditor";

export const metadata = { title: "Sản phẩm – Moana Beauty" };

export default async function ProductsPage() {
  const { supabase, profile } = await getCurrentUser();
  if (!isStaffRole(profile?.role)) return <p className="card text-sm">Trang dành cho nhân viên.</p>;
  const canEdit = canManageStock(profile?.role);
  const [{ data: products }, pct] = await Promise.all([
    supabase.from("products").select(PRODUCT_COLUMNS).order("name"),
    fetchDefaultDiscountPct(supabase),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-navy">Sản phẩm</h1>
        <p className="text-sm text-ink/70">
          Danh mục dùng chung cho cả 2 chi nhánh. Bấm vào sản phẩm để xem đầy đủ thông tin, tồn kho{canEdit ? " và sửa" : ""}.
        </p>
      </div>
      <ProductEditor products={(products ?? []) as Product[]} costs={{}} defaultPct={pct} isOwner={profile?.role === "owner"} canEdit={canEdit} showCost={profile?.role === "owner" || profile?.role === "manager"} />
    </div>
  );
}
