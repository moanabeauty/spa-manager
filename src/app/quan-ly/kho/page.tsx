import { activeBranches } from "@/lib/refData";
import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import { PRODUCT_COLUMNS, WAREHOUSE_LABEL, canEditProducts, canManageStock, fetchDefaultDiscountPct, fetchStock, type Product, type Warehouse, type WarehouseType } from "@/lib/inventory";
import { KhoNav, pickBranch } from "./shared";
import StockList from "./StockList";

export const metadata = { title: "Tồn kho – Moana Beauty" };

export default async function StockPage({ searchParams }: { searchParams: Promise<{ cn?: string; kho?: string }> }) {
  const { supabase, profile } = await getCurrentUser();
  const sp = await searchParams;
  const type: WarehouseType = sp.kho === "retail" ? "retail" : "treatment";

  const { data: branches } = await activeBranches();
  const { branchId, canSwitch } = pickBranch(profile, branches ?? [], sp.cn);

  const canEdit = canEditProducts(profile?.roles);
  const [{ data: whs }, { data: products }, defaultPct] = await Promise.all([
    supabase.from("warehouses").select("id, branch_id, type, name").eq("branch_id", branchId),
    supabase.from("products").select(PRODUCT_COLUMNS).eq("is_active", true).order("name"),
    canEdit ? fetchDefaultDiscountPct(supabase) : Promise.resolve(0),
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

  const branchName = (branches ?? []).find((b) => b.id === branchId)?.name ?? "";

  return (
    <div className="page-wide space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brown">Kho · {branchName}</p>
          <h1 className="mt-1 text-navy">Tồn kho</h1>
          <p className="mt-1 text-sm text-ink/60">Mỗi chi nhánh có kho liệu trình (hàng KTV dùng) và kho bán lẻ (hàng bán cho khách).</p>
        </div>
        {manage && (
          <div className="flex flex-wrap gap-2">
            <Link href="/quan-ly/kho/nhap-hang" className="btn-primary px-5 py-2.5">Nhập hàng</Link>
            <Link href="/quan-ly/kho/chuyen-kho" className="btn-outline px-5 py-2.5">Chuyển kho</Link>
            <Link href="/quan-ly/kho/kiem-kho" className="btn-outline px-5 py-2.5">Kiểm kho</Link>
          </div>
        )}
      </div>
      <KhoNav active="ton" role={profile!.role} pending={manage ? pending ?? 0 : 0} />

      <div className="flex flex-wrap items-center gap-2">
        {canSwitch && (
          <div className="flex rounded-full bg-surface p-1 ring-1 ring-beige-dark/70">
            {(branches ?? []).map((b) => (
              <Link
                key={b.id}
                href={link(b.id, type)}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${b.id === branchId ? "bg-navy text-white shadow" : "text-navy/70 hover:text-navy"}`}
              >
                {b.name}
              </Link>
            ))}
          </div>
        )}
        <div className="flex rounded-full bg-surface p-1 ring-1 ring-beige-dark/70">
          {(["treatment", "retail"] as const).map((t) => (
            <Link
              key={t}
              href={link(branchId, t)}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${t === type ? "bg-gold-soft text-navy ring-1 ring-gold/60" : "text-navy/70 hover:text-navy"}`}
            >
              {WAREHOUSE_LABEL[t]}
            </Link>
          ))}
        </div>
        {manage && (pending ?? 0) > 0 && (
          <Link href="/quan-ly/kho/xin-xuat" className="chip ml-auto bg-[#FFE8BA] py-1.5 text-[#7A5600]">{pending} phiếu xin xuất chờ duyệt →</Link>
        )}
      </div>

      {type === "retail" && profile?.role !== "warehouse" && (
        <p className="text-xs text-ink/60">
          Bán lẻ cho khách: mở <Link href="/quan-ly/thu-tien" className="font-semibold text-navy underline">Thu tiền</Link> → “Bán sản phẩm lẻ”, kho bán lẻ tự trừ khi thu.
        </p>
      )}
      {!wh ? (
        <p className="card text-sm">Chi nhánh này chưa có {WAREHOUSE_LABEL[type].toLowerCase()}.</p>
      ) : (
        <StockList
          warehouseId={wh.id}
          warehouseType={type}
          warehouseName={`${WAREHOUSE_LABEL[type]} ${branchName}`}
          products={list}
          qty={qty}
          canManage={manage}
          canEdit={canEdit}
          defaultPct={defaultPct}
          showCost={profile?.role === "owner" || profile?.role === "manager"}
        />
      )}
    </div>
  );
}
