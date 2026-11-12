import { activeBranches } from "@/lib/refData";
import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import { PRODUCT_COLUMNS, WAREHOUSE_LABEL, canManageStock, fetchStock, type Product, type Warehouse, type WarehouseType } from "@/lib/inventory";
import { KhoNav, pickBranch } from "./shared";
import StockList from "./StockList";

export const metadata = { title: "Tồn kho – Moana Beauty" };

export default async function StockPage({ searchParams }: { searchParams: Promise<{ cn?: string; kho?: string }> }) {
  const { supabase, profile } = await getCurrentUser();
  const sp = await searchParams;
  const type: WarehouseType = sp.kho === "retail" ? "retail" : "treatment";

  const { data: branches } = await activeBranches();
  const { branchId, canSwitch } = pickBranch(profile, branches ?? [], sp.cn);

  const [{ data: whs }, { data: products }] = await Promise.all([
    supabase.from("warehouses").select("id, branch_id, type, name").eq("branch_id", branchId),
    supabase.from("products").select(PRODUCT_COLUMNS).eq("is_active", true).order("name"),
  ]);
  const warehouses = (whs ?? []) as Warehouse[];
  const wh = warehouses.find((w) => w.type === type);
  const stock = await fetchStock(supabase, warehouses.map((w) => w.id));
  const qty = Object.fromEntries(stock.get(wh?.id ?? "") ?? new Map());

  const { count: pending } = await supabase
    .from("stock_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .in("warehouse_id", warehouses.map((w) => w.id));

  const manage = canManageStock(profile?.role) && (profile?.role !== "warehouse" || profile?.branch_id === branchId);
  const list = ((products ?? []) as Product[]).filter((p) =>
    type === "treatment" ? p.for_treatment || qty[p.id] : p.for_retail || qty[p.id],
  );
  const link = (cn: string, kho: WarehouseType) => `/quan-ly/kho?cn=${cn}&kho=${kho}`;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-navy">Kho</h1>
        <p className="text-sm text-ink/70">Mỗi chi nhánh có kho liệu trình (hàng KTV dùng) và kho bán lẻ (hàng bán cho khách).</p>
      </div>
      <KhoNav active="ton" role={profile!.role} pending={manage ? pending ?? 0 : 0} />

      <div className="card space-y-3 p-4">
        {canSwitch && (
          <div className="flex flex-wrap gap-2">
            {(branches ?? []).map((b) => (
              <Link
                key={b.id}
                href={link(b.id, type)}
                className={`rounded-full px-3 py-1.5 text-sm font-semibold ${b.id === branchId ? "bg-navy text-white" : "bg-white text-navy ring-1 ring-beige-dark"}`}
              >
                {b.name}
              </Link>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          {(["treatment", "retail"] as const).map((t) => (
            <Link
              key={t}
              href={link(branchId, t)}
              className={`flex-1 rounded-xl px-3 py-2 text-center text-sm font-semibold ${t === type ? "bg-beige text-navy ring-2 ring-navy/30" : "bg-cream text-navy/70"}`}
            >
              {WAREHOUSE_LABEL[t]}
            </Link>
          ))}
        </div>
      </div>

      {type === "retail" && profile?.role !== "warehouse" && (
        <p className="text-xs text-ink/60">
          Bán lẻ cho khách: mở <Link href="/quan-ly/thu-tien" className="font-semibold text-navy underline">Thu tiền</Link> → “Bán sản phẩm lẻ”, kho bán lẻ tự trừ khi thu.
        </p>
      )}
      {!wh ? (
        <p className="card text-sm">Chi nhánh này chưa có {WAREHOUSE_LABEL[type].toLowerCase()}.</p>
      ) : (
        <StockList warehouseId={wh.id} warehouseType={type} products={list} qty={qty} canManage={manage} />
      )}
    </div>
  );
}
