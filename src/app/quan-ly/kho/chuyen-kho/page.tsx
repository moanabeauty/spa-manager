import { activeBranches } from "@/lib/refData";
import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import { formatShortDate, formatTime } from "@/lib/format";
import { PRODUCT_COLUMNS, WAREHOUSE_LABEL, canManageStock, fetchStock, productLabel, type Product, type Warehouse } from "@/lib/inventory";
import { pickBranch } from "../shared";
import TransferForm from "./TransferForm";

export const metadata = { title: "Chuyển kho – Moana Beauty" };

type Move = {
  id: string; quantity: number; note: string | null; created_at: string; warehouse_id: string;
  products: { name: string; capacity: string | null; unit: string } | null;
  profiles: { full_name: string | null } | null;
};

export default async function TransferPage({ searchParams }: { searchParams: Promise<{ cn?: string; huong?: string }> }) {
  const { supabase, profile } = await getCurrentUser();
  if (!canManageStock(profile?.role)) return <p className="card text-sm">Trang dành cho quản lý kho, quản lý và chủ spa.</p>;
  const sp = await searchParams;
  const toTreatment = sp.huong !== "ban-le"; // mặc định: bán lẻ → liệu trình
  const { data: branches } = await activeBranches();
  const { branchId, canSwitch } = pickBranch(profile, branches ?? [], sp.cn);
  const [{ data: whs }, { data: products }] = await Promise.all([
    supabase.from("warehouses").select("id, branch_id, type, name").eq("branch_id", branchId),
    supabase.from("products").select(PRODUCT_COLUMNS).eq("is_active", true).order("name"),
  ]);
  const warehouses = (whs ?? []) as Warehouse[];
  const retail = warehouses.find((w) => w.type === "retail");
  const treatment = warehouses.find((w) => w.type === "treatment");
  const from = toTreatment ? retail : treatment;
  const to = toTreatment ? treatment : retail;
  const stock = await fetchStock(supabase, from ? [from.id] : []);
  const qty = Object.fromEntries(stock.get(from?.id ?? "") ?? new Map()) as Record<string, number>;
  const available = ((products ?? []) as Product[]).filter((p) => (qty[p.id] ?? 0) > 0);

  const { data: moveData } = await supabase
    .from("stock_movements")
    .select("id, quantity, note, created_at, warehouse_id, products(name, capacity, unit), profiles(full_name)")
    .eq("movement_type", "transfer_out")
    .in("warehouse_id", warehouses.map((w) => w.id))
    .order("created_at", { ascending: false })
    .limit(40);
  const moves = (moveData ?? []) as unknown as Move[];
  const link = (o: Record<string, string>) => `/quan-ly/kho/chuyen-kho?${new URLSearchParams({ cn: branchId, huong: toTreatment ? "lieu-trinh" : "ban-le", ...o })}`;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-navy">Chuyển kho</h1>
        <p className="text-sm text-ink/70">Chuyển hàng giữa kho bán lẻ và kho liệu trình của cùng chi nhánh, tồn kho 2 bên cập nhật ngay.</p>
      </div>
      <div className="card space-y-3 p-4">
        {canSwitch && (
          <div className="flex flex-wrap gap-2">
            {(branches ?? []).map((b) => (
              <Link key={b.id} href={link({ cn: b.id })} className={`rounded-full px-3 py-1.5 text-sm font-semibold ${b.id === branchId ? "bg-navy text-white" : "bg-white text-navy ring-1 ring-beige-dark"}`}>
                {b.name}
              </Link>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <Link href={link({ huong: "lieu-trinh" })} className={`flex-1 rounded-xl px-3 py-2 text-center text-sm font-semibold ${toTreatment ? "bg-beige text-navy ring-2 ring-navy/30" : "bg-cream text-navy/70"}`}>
            {WAREHOUSE_LABEL.retail} → {WAREHOUSE_LABEL.treatment}
          </Link>
          <Link href={link({ huong: "ban-le" })} className={`flex-1 rounded-xl px-3 py-2 text-center text-sm font-semibold ${!toTreatment ? "bg-beige text-navy ring-2 ring-navy/30" : "bg-cream text-navy/70"}`}>
            {WAREHOUSE_LABEL.treatment} → {WAREHOUSE_LABEL.retail}
          </Link>
        </div>
      </div>
      {from && to ? (
        <TransferForm
          key={`${from.id}-${to.id}`}
          fromId={from.id}
          toId={to.id}
          fromName={from.name}
          toName={to.name}
          products={available.map((p) => ({ id: p.id, label: productLabel(p), brand: p.brand, unit: p.unit, barcode: p.barcode, qty: qty[p.id] ?? 0 }))}
        />
      ) : (
        <p className="card text-sm">Chi nhánh này chưa đủ 2 kho.</p>
      )}

      <div className="card p-0">
        <p className="px-4 pt-3 text-sm font-semibold text-navy">Lần chuyển gần đây</p>
        {moves.length === 0 ? (
          <p className="px-4 py-3 text-sm text-ink/60">Chưa chuyển lần nào.</p>
        ) : (
          <ul className="divide-y divide-beige text-sm">
            {moves.map((m) => (
              <li key={m.id} className="flex justify-between gap-3 px-4 py-2">
                <span className="min-w-0">
                  {m.products?.name}{m.products?.capacity ? ` · ${m.products.capacity}` : ""}
                  <span className="block truncate text-xs text-ink/55">
                    {formatShortDate(m.created_at)} {formatTime(m.created_at)} · {m.profiles?.full_name ?? "?"} · {m.note}
                  </span>
                </span>
                <b className="shrink-0">{-m.quantity} {m.products?.unit}</b>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
