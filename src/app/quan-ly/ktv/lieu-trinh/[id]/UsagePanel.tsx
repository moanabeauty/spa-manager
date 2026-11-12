"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { vnError } from "@/lib/format";
import { fmtQty } from "@/lib/inventory";

type Item = { item_id: string; step_no: number; name: string; product_id: string; qty: number; changed: boolean; alts: { id: string; label: string }[] };
type Prod = {
  product_id: string; label: string; unit: string; need: number; single_use: boolean;
  available: number; bottles: number; short: boolean; confirm: "pending" | "approved" | "rejected" | null;
};
type Preview = { warehouse_id: string | null; items: Item[]; products: Prod[] };

/**
 * Bấm "Hoàn thành buổi" → hiện các sản phẩm sẽ trừ theo định mức (KTV không sửa được số lượng).
 * Thiếu chai đang mở → không cho hoàn thành: Xin xuất chai mới hoặc xin chủ spa xác nhận còn hàng.
 */
export default function UsagePanel({ apsId, busy, onCancel, onConfirm }: {
  apsId: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (choices: Record<string, string>) => void;
}) {
  const [data, setData] = useState<Preview | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    box.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const load = useCallback(async () => {
    const { data: d, error: e } = await createClient().rpc("session_usage_preview", { p_aps: apsId, p_choices: choices });
    if (e) return setError(vnError(e.message));
    setData(d as Preview);
  }, [apsId, choices]);

  useEffect(() => {
    load();
  }, [load]);

  // đang chờ chủ spa xác nhận → tự kiểm tra lại
  useEffect(() => {
    if (!data?.products.some((p) => p.short && p.confirm === "pending")) return;
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [data, load]);

  async function askConfirm(productId: string) {
    setSending(productId);
    setError(null);
    const { error: e } = await createClient().rpc("request_stock_confirm", { p_aps: apsId, p_product: productId, p_note: null });
    setSending(null);
    if (e) return setError(vnError(e.message));
    load();
  }

  const short = data?.products.filter((p) => p.short) ?? [];
  const withAlts = data?.items.filter((i) => i.alts.length > 1) ?? [];

  return (
    <div ref={box} className="space-y-2.5 rounded-[14px] bg-white p-3.5 ring-2 ring-navy">
      <p className="text-sm font-bold">Sản phẩm trừ khi hoàn thành buổi</p>
      {!data && !error && <p className="text-xs text-[#646464]">Đang tính…</p>}

      {withAlts.map((i) => (
        <label key={i.item_id} className="block space-y-1 text-xs">
          <span className="font-semibold">Bước {i.step_no}: chọn sản phẩm thực tế dùng</span>
          <select
            className="input py-2 text-sm"
            value={choices[i.item_id] ?? i.product_id}
            onChange={(e) => setChoices((c) => ({ ...c, [i.item_id]: e.target.value }))}
          >
            {i.alts.map((a) => (
              <option key={a.id} value={a.id}>{a.label}</option>
            ))}
          </select>
        </label>
      ))}

      {data && data.products.length === 0 && <p className="text-xs text-[#646464]">Liệu trình này không có sản phẩm cần trừ.</p>}
      <ul className="space-y-1.5">
        {data?.products.map((p) => (
          <li key={p.product_id} className={`rounded-[10px] px-2.5 py-2 text-xs ${p.short ? "bg-[#FDECEA] text-[#8C1D18]" : "bg-cream/70"}`}>
            <div className="flex justify-between gap-2">
              <span className="font-medium">{p.label}</span>
              <b className="shrink-0">−{fmtQty(p.need)} {p.unit}</b>
            </div>
            <p className="text-[11px] opacity-80">
              {p.single_use
                ? "Hàng dùng 1 lần – đã trừ khi xuất kho"
                : p.bottles > 0
                  ? `Chai đang mở còn ${fmtQty(p.available)} ${p.unit}${p.bottles > 1 ? ` (${p.bottles} chai)` : ""}`
                  : "Chi nhánh chưa có chai đang mở"}
            </p>
            {p.short && (
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <Link href="/quan-ly/kho/xin-xuat" className="rounded-lg bg-navy px-2.5 py-1 text-[11px] font-semibold text-white">
                  Xin xuất chai mới
                </Link>
                {p.confirm === "pending" ? (
                  <span className="text-[11px] font-semibold">⏳ Đang chờ chủ spa xác nhận còn hàng</span>
                ) : (
                  <button
                    type="button"
                    disabled={sending === p.product_id}
                    onClick={() => askConfirm(p.product_id)}
                    className="rounded-lg border border-[#8C1D18] px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50"
                  >
                    {p.confirm === "rejected" ? "Chủ spa chưa xác nhận · xin lại" : "Xin chủ spa xác nhận còn hàng"}
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {short.length > 0 && (
        <p className="text-xs font-semibold text-[#8C1D18]">
          Chưa hoàn thành được: chi nhánh không đủ {short.length} sản phẩm trong chai đang mở.
        </p>
      )}
      {error && <p className="text-xs text-[#B3261E]">{error}</p>}
      <div className="flex gap-2">
        <button className="btn-ghost flex-1" onClick={onCancel}>Quay lại</button>
        {short.length > 0 ? (
          <button className="btn-outline flex-1" onClick={load}>Kiểm tra lại</button>
        ) : (
          <button className="btn-primary flex-1" disabled={busy || !data} onClick={() => onConfirm(choices)}>
            Xác nhận hoàn thành
          </button>
        )}
      </div>
    </div>
  );
}
