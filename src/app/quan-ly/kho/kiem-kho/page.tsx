import { activeBranches } from "@/lib/refData";
import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import { formatShortDate, formatTime } from "@/lib/format";
import { PRODUCT_COLUMNS, WAREHOUSE_LABEL, openLevelLabel, canManageStock, fetchStock, productLabel, type Product, type Warehouse, type WarehouseType } from "@/lib/inventory";
import { pickBranch } from "../shared";
import CountForm, { CountReview } from "./CountForm";
import OpeningForm from "./OpeningForm";

export const metadata = { title: "Kiểm kho – Moana Beauty" };

type Count = {
  id: string; code: string; kind: string; status: string; note: string | null; created_at: string; review_note: string | null; warehouse_id: string;
  creator: { full_name: string | null } | null;
  stock_count_items: { product_id: string; system_qty: number; counted_qty: number; products: { name: string; capacity: string | null; unit: string } | null }[];
  stock_count_opened: { product_id: string; remaining_pct: number; products: { name: string; capacity: string | null } | null }[];
};
const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Chờ chủ spa duyệt", cls: "bg-[#FFE8BA] text-[#7A5600]" },
  applied: { label: "Đã cập nhật tồn", cls: "bg-[#D6EDD8] text-[#22612A]" },
  rejected: { label: "Không duyệt", cls: "bg-[#F6D5D5] text-[#8A2323]" },
};

export default async function StockCountPage({ searchParams }: { searchParams: Promise<{ cn?: string; kho?: string; loai?: string }> }) {
  const { supabase, profile } = await getCurrentUser();
  if (!canManageStock(profile?.role)) return <p className="card text-sm">Trang dành cho quản lý kho, quản lý và chủ spa.</p>;
  const sp = await searchParams;
  const type: WarehouseType = sp.kho === "retail" ? "retail" : "treatment";
  const opening = sp.loai === "dau-ky";
  const { data: branches } = await activeBranches();
  const { branchId, canSwitch } = pickBranch(profile, branches ?? [], sp.cn);
  const [{ data: whs }, { data: products }] = await Promise.all([
    supabase.from("warehouses").select("id, branch_id, type, name"),
    supabase.from("products").select(PRODUCT_COLUMNS).eq("is_active", true).order("name"),
  ]);
  const warehouses = (whs ?? []) as Warehouse[];
  const wh = warehouses.find((w) => w.branch_id === branchId && w.type === type);
  const stock = await fetchStock(supabase, wh ? [wh.id] : []);
  const qty = Object.fromEntries(stock.get(wh?.id ?? "") ?? new Map());
  const list = ((products ?? []) as Product[]).filter((p) => (type === "treatment" ? p.for_treatment : p.for_retail) || qty[p.id]);

  const { data: countData } = await supabase
    .from("stock_counts")
    .select("id, code, kind, status, note, created_at, review_note, warehouse_id, creator:profiles!stock_counts_created_by_fkey(full_name), stock_count_items(product_id, system_qty, counted_qty, products(name, capacity, unit)), stock_count_opened(product_id, remaining_pct, products(name, capacity))")
    .order("created_at", { ascending: false })
    .limit(30);
  const counts = (countData ?? []) as unknown as Count[];
  const isOwner = profile?.role === "owner";
  const whName = (id: string) => warehouses.find((w) => w.id === id)?.name ?? "";
  const link = (cn: string, kho: WarehouseType, dauKy = opening) => `/quan-ly/kho/kiem-kho?cn=${cn}&kho=${kho}${dauKy ? "&loai=dau-ky" : ""}`;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-navy">Kiểm kho</h1>
        <p className="text-sm text-ink/70">
          {opening
            ? <>Kiểm đầu kỳ: đếm toàn bộ hàng đang có khi bắt đầu dùng app — chai nguyên và chai đang dở (ước lượng 3/4, 1/2, 1/3, 1/4…). {isOwner ? "Chủ spa lưu là cập nhật luôn." : "Chủ spa duyệt xong mới cập nhật tồn kho."}</>
            : <>Đếm hàng thực tế rồi nhập số. Không lệch thì xong ngay; có lệch thì cần ghi lý do và {isOwner ? "cập nhật luôn (chủ spa)" : "chờ chủ spa duyệt mới cập nhật tồn kho"}.</>}
        </p>
      </div>

      <div className="flex gap-2">
        {([false, true] as const).map((d) => (
          <Link key={String(d)} href={link(branchId, type, d)} className={`flex-1 rounded-xl px-3 py-2 text-center text-sm font-semibold ${d === opening ? "bg-navy text-white" : "bg-white text-navy ring-1 ring-beige-dark"}`}>
            {d ? "Kiểm đầu kỳ" : "Kiểm kho thường"}
          </Link>
        ))}
      </div>

      <div className="card space-y-3 p-4">
        {canSwitch && (
          <div className="flex flex-wrap gap-2">
            {(branches ?? []).map((b) => (
              <Link key={b.id} href={link(b.id, type)} className={`rounded-full px-3 py-1.5 text-sm font-semibold ${b.id === branchId ? "bg-navy text-white" : "bg-white text-navy ring-1 ring-beige-dark"}`}>
                {b.name}
              </Link>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          {(["treatment", "retail"] as const).map((t) => (
            <Link key={t} href={link(branchId, t)} className={`flex-1 rounded-xl px-3 py-2 text-center text-sm font-semibold ${t === type ? "bg-beige text-navy ring-2 ring-navy/30" : "bg-cream text-navy/70"}`}>
              {WAREHOUSE_LABEL[t]}
            </Link>
          ))}
        </div>
      </div>

      {counts.some((c) => c.status === "pending") && (
        <div className="space-y-2">
          <h2 className="font-semibold text-navy">Phiếu chờ duyệt</h2>
          {counts.filter((c) => c.status === "pending").map((c) => (
            <CountCard key={c.id} c={c} whName={whName} review={isOwner} />
          ))}
        </div>
      )}

      {wh && opening ? (
        <OpeningForm key={wh.id + "-dk"} warehouseId={wh.id} treatment={type === "treatment"} isOwner={isOwner} products={list.map((p) => ({ id: p.id, label: productLabel(p), brand: p.brand, unit: p.unit, volume: p.volume, barcode: p.barcode, qty: qty[p.id] ?? 0 }))} />
      ) : wh ? (
        <CountForm key={wh.id} warehouseId={wh.id} products={list.map((p) => ({ id: p.id, label: productLabel(p), brand: p.brand, unit: p.unit, barcode: p.barcode, qty: qty[p.id] ?? 0 }))} />
      ) : (
        <p className="card text-sm">Chi nhánh này chưa có {WAREHOUSE_LABEL[type].toLowerCase()}.</p>
      )}

      {counts.some((c) => c.status !== "pending") && (
        <div className="space-y-2">
          <h2 className="font-semibold text-navy">Phiếu kiểm kho gần đây</h2>
          {counts.filter((c) => c.status !== "pending").map((c) => (
            <CountCard key={c.id} c={c} whName={whName} review={false} />
          ))}
        </div>
      )}
    </div>
  );
}

function CountCard({ c, whName, review }: { c: Count; whName: (id: string) => string; review: boolean }) {
  const isOpening = c.kind === "opening";
  const diffs = c.stock_count_items.filter((i) => isOpening || i.counted_qty !== i.system_qty);
  const opened = c.stock_count_opened ?? [];
  return (
    <div className={`card p-4 text-sm ${c.status === "pending" ? "border-l-4 border-l-[#E0A526]" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{isOpening && <span className="mr-1 rounded bg-navy px-1.5 py-0.5 text-[10px] text-white">ĐẦU KỲ</span>}{c.code} · {whName(c.warehouse_id)}</p>
          <p className="text-xs text-ink/60">
            {formatShortDate(c.created_at)} {formatTime(c.created_at)} · {c.creator?.full_name ?? "?"} · đếm {c.stock_count_items.length} sản phẩm{isOpening ? `, ${opened.length} chai đang dở` : `, lệch ${diffs.length}`}
          </p>
          {c.note && <p className="text-xs">Lý do: {c.note}</p>}
          {c.review_note && <p className="text-xs text-ink/60">Chủ spa: {c.review_note}</p>}
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS[c.status]?.cls}`}>{STATUS[c.status]?.label}</span>
      </div>
      {diffs.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs">
          {diffs.map((i) => (
            <li key={i.product_id} className="flex justify-between gap-2">
              <span className="min-w-0 truncate">{i.products?.name}{i.products?.capacity ? ` · ${i.products.capacity}` : ""}</span>
              <span className="shrink-0">
                máy {i.system_qty} → {isOpening ? "nguyên" : "đếm"} {i.counted_qty}{" "}
                {i.counted_qty !== i.system_qty && (
                  <b className={i.counted_qty > i.system_qty ? "text-[#22612A]" : "text-[#8A2323]"}>
                    ({i.counted_qty > i.system_qty ? "+" : ""}{i.counted_qty - i.system_qty})
                  </b>
                )}
                {opened.some((o) => o.product_id === i.product_id) && (
                  <span className="ml-1 text-navy">
                    · dở {opened.filter((o) => o.product_id === i.product_id).map((o) => openLevelLabel(Number(o.remaining_pct))).join(", ")}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {review && <CountReview id={c.id} />}
    </div>
  );
}
