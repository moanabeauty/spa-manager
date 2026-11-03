import { getCurrentUser } from "@/lib/supabase/server";
import { PRODUCT_COLUMNS, canManageStock, type Product, type Warehouse } from "@/lib/inventory";
import { KhoNav, pickBranch } from "../shared";
import ReceiveForm, { type RecentReceipt } from "./ReceiveForm";

export const metadata = { title: "Nhập hàng – Moana Beauty" };

export default async function ReceivePage({ searchParams }: { searchParams: Promise<{ cn?: string; kho?: string }> }) {
  const { supabase, profile } = await getCurrentUser();
  if (!canManageStock(profile?.role)) {
    return <p className="card text-sm">Chỉ quản lý kho, quản lý và chủ spa được nhập hàng.</p>;
  }
  const sp = await searchParams;
  const { data: branches } = await supabase.from("branches").select("id, name").eq("is_active", true).order("name");
  const { branchId, canSwitch } = pickBranch(profile, branches ?? [], sp.cn);

  const [{ data: whs }, { data: products }, { data: costs }, { data: receipts }] = await Promise.all([
    supabase.from("warehouses").select("id, branch_id, type, name"),
    supabase.from("products").select(PRODUCT_COLUMNS).order("name"),
    supabase.rpc("product_costs"),
    supabase
      .from("stock_receipts")
      .select("id, code, supplier, created_at, warehouses(name), profiles(full_name), stock_movements(quantity)")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);
  const warehouses = ((whs ?? []) as Warehouse[]).filter((w) => (canSwitch ? true : w.branch_id === branchId));
  const costMap = Object.fromEntries(((costs ?? []) as { product_id: string; cost_price: number | null }[]).map((c) => [c.product_id, c.cost_price]));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-navy">Nhập hàng</h1>
        <p className="text-sm text-ink/70">Quét mã vạch trên vỏ hộp (máy quét hoặc camera điện thoại), nhập số lượng rồi lưu phiếu nhập.</p>
      </div>
      <KhoNav active="nhap" role={profile!.role} />
      <ReceiveForm
        branches={(branches ?? []).filter((b) => canSwitch || b.id === branchId)}
        defaultBranchId={branchId}
        defaultType={sp.kho === "retail" ? "retail" : "treatment"}
        warehouses={warehouses}
        initialProducts={(products ?? []) as Product[]}
        costs={costMap}
        recent={(receipts ?? []) as unknown as RecentReceipt[]}
      />
    </div>
  );
}

