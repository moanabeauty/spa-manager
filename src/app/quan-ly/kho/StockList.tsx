"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatVnd, normalizeText, vnError } from "@/lib/format";
import { productLabel, type Product, type WarehouseType } from "@/lib/inventory";

type Filter = "all" | "in" | "low";

export default function StockList({
  warehouseId,
  warehouseType,
  products,
  qty,
  canManage,
}: {
  warehouseId: string;
  warehouseType: WarehouseType;
  products: Product[];
  qty: Record<string, number>;
  canManage: boolean;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<string | null>(null);

  const isLow = (p: Product) => (qty[p.id] ?? 0) <= p.min_stock;
  const rows = useMemo(() => {
    const q = normalizeText(query.trim());
    return products
      .filter((p) => !q || normalizeText(`${p.brand ?? ""} ${p.name} ${p.category ?? ""} ${p.barcode ?? ""}`).includes(q))
      .filter((p) => (filter === "in" ? (qty[p.id] ?? 0) > 0 : filter === "low" ? isLow(p) : true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, query, filter, qty]);

  // nhóm theo nhóm sản phẩm (kho liệu trình) hoặc nhãn hàng (kho bán lẻ)
  const groups = useMemo(() => {
    const m = new Map<string, Product[]>();
    rows.forEach((p) => {
      const g = (warehouseType === "treatment" ? p.category : p.brand) ?? "Khác";
      m.set(g, [...(m.get(g) ?? []), p]);
    });
    return [...m.entries()];
  }, [rows, warehouseType]);

  const total = products.reduce((a, p) => a + Math.max(0, qty[p.id] ?? 0), 0);
  const lowCount = products.filter(isLow).length;

  return (
    <div className="space-y-3">
      <div className="card space-y-3 p-4">
        <input
          className="input py-2"
          placeholder="Tìm theo tên, nhãn hàng, nhóm hoặc mã vạch…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {(
            [
              ["all", `Tất cả (${products.length})`],
              ["in", "Còn hàng"],
              ["low", `Sắp hết / hết (${lowCount})`],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              className={`rounded-full px-3 py-1.5 font-semibold ${filter === k ? "bg-navy text-white" : "bg-cream text-navy"}`}
              onClick={() => setFilter(k)}
            >
              {label}
            </button>
          ))}
          <span className="ml-auto text-ink/60">Tổng {total} đơn vị hàng</span>
        </div>
      </div>

      {products.length === 0 && (
        <p className="card text-sm text-ink/60">
          Kho chưa có sản phẩm nào.{" "}
          {canManage && (
            <Link href="/quan-ly/kho/nhap-hang" className="font-semibold text-navy underline">Nhập hàng</Link>
          )}
        </p>
      )}

      {groups.map(([g, ps]) => (
        <div key={g} className="card p-0">
          <p className="border-b border-beige px-4 py-2 text-xs font-bold uppercase tracking-wide text-brown">{g}</p>
          <ul className="divide-y divide-beige">
            {ps.map((p) => {
              const q = qty[p.id] ?? 0;
              return (
                <li key={p.id} className="px-4 py-2.5 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{productLabel(p)}</p>
                      <p className="text-xs text-ink/55">
                        {[p.brand, p.used_in && warehouseType === "treatment" ? `Dùng: ${p.used_in}` : null,
                          warehouseType === "retail" && p.retail_price != null ? `Giá niêm yết ${formatVnd(p.retail_price)}` : null]
                          .filter(Boolean)
                          .join(" · ")}
                        {!p.barcode && canManage && <span className="ml-1 text-[#7A5600]">· chưa có mã vạch</span>}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={`text-base font-bold ${q <= 0 ? "text-[#8A2323]" : isLow(p) ? "text-[#7A5600]" : "text-navy"}`}>
                        {q} <span className="text-xs font-normal text-ink/60">{p.unit}</span>
                      </p>
                      {canManage && (
                        <button className="text-xs text-navy underline" onClick={() => setEditing(editing === p.id ? null : p.id)}>
                          Kiểm kê
                        </button>
                      )}
                    </div>
                  </div>
                  {editing === p.id && (
                    <AdjustForm warehouseId={warehouseId} product={p} current={q} onDone={() => setEditing(null)} />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {products.length > 0 && rows.length === 0 && <p className="card text-sm text-ink/60">Không có sản phẩm phù hợp.</p>}
    </div>
  );
}

function AdjustForm({ warehouseId, product, current, onDone }: { warehouseId: string; product: Product; current: number; onDone: () => void }) {
  const router = useRouter();
  const [counted, setCounted] = useState(String(Math.max(0, current)));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = Number(counted);
  const valid = counted !== "" && Number.isInteger(n) && n >= 0;

  async function save() {
    setBusy(true);
    setError(null);
    const { error } = await createClient().rpc("adjust_stock", {
      p_warehouse_id: warehouseId,
      p_product_id: product.id,
      p_counted: n,
      p_reason: reason,
    });
    setBusy(false);
    if (error) return setError(vnError(error.message));
    onDone();
    router.refresh();
  }

  return (
    <div className="mt-2 space-y-2 rounded-xl bg-cream p-3 text-xs">
      <p>Đếm thực tế trong kho, hệ thống tự ghi phần chênh lệch.</p>
      <div className="flex flex-wrap items-center gap-2">
        <span>Số đếm được</span>
        <input
          type="number"
          min={0}
          inputMode="numeric"
          className="w-20 rounded-lg border border-beige-dark px-2 py-1.5 text-right text-sm"
          value={counted}
          onChange={(e) => setCounted(e.target.value)}
        />
        <span>{product.unit}</span>
        {valid && n !== current && (
          <span className={n > current ? "text-[#22612A]" : "text-[#8A2323]"}>
            ({n > current ? "+" : ""}
            {n - current})
          </span>
        )}
      </div>
      <input
        className="w-full rounded-lg border border-beige-dark px-2 py-1.5 text-sm"
        placeholder="Lý do (bắt buộc): kiểm kê cuối tháng, hàng hỏng, vỡ…"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      {error && <p className="text-[#8A2323]">{error}</p>}
      <div className="flex justify-end gap-2">
        <button className="btn-ghost py-1.5" onClick={onDone}>Đóng</button>
        <button className="btn-primary py-1.5" disabled={busy || !valid || n === current || !reason.trim()} onClick={save}>
          {busy ? "Đang lưu…" : "Lưu kiểm kê"}
        </button>
      </div>
    </div>
  );
}
