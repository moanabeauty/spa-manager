import { getCurrentUser } from "@/lib/supabase/server";
import MenuEditor, { type MenuService } from "./MenuEditor";

export const metadata = { title: "Menu dịch vụ – Moana Beauty" };

export default async function ServiceMenuPage() {
  const { supabase, profile } = await getCurrentUser();
  if (profile?.role !== "owner" && profile?.role !== "manager") {
    return <p className="card text-sm">Chỉ chủ spa và quản lý sửa được menu dịch vụ.</p>;
  }
  const [{ data: categories }, { data: services }, { data: costs }, { data: branches }] = await Promise.all([
    supabase.from("service_categories").select("id, name, sort_order").order("sort_order"),
    supabase
      .from("services")
      .select("id, category_id, name, name_en, duration_minutes, price, member_price, card_allowed, commission_eligible, fee_once_per_visit, is_active, branch_id")
      .order("name"),
    supabase.rpc("service_internal_costs"),
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
  ]);
  const feeById = new Map(((costs ?? []) as { service_id: string; technician_fee: number }[]).map((c) => [c.service_id, c.technician_fee]));
  const rows = ((services ?? []) as Omit<MenuService, "technician_fee">[]).map((s) => ({
    ...s,
    technician_fee: Number(feeById.get(s.id) ?? 0),
  }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-navy">Menu dịch vụ</h1>
        <p className="mt-1 text-sm text-ink/70">
          Sửa trực tiếp thời lượng, giá và tiền dịch vụ KTV rồi bấm <b>Lưu</b> ở cuối trang. Bỏ trống giá = &quot;báo giá tại
          spa&quot;. Thay đổi chỉ áp dụng cho lịch hẹn tạo sau đó, lịch cũ giữ nguyên giá lúc đặt.
        </p>
      </div>
      <MenuEditor categories={categories ?? []} services={rows} branches={branches ?? []} />
    </div>
  );
}
