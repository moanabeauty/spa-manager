"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { vnError } from "@/lib/format";
import { volumeUnit } from "@/lib/inventory";
import PackQty, { initPack, packChange, packError, packTotal, type PackEntry } from "@/components/PackQty";

export type CountP = {
  id: string; label: string; brand: string | null; unit: string; volume?: number | null; pack_size?: number | null;
  capacity?: string | null; barcode: string | null; qty: number;
};
export type Cell = { pe: PackEntry; open: boolean };

/** Ô đếm 1 sản phẩm: gọn (1 ô số theo đơn vị hiện tại) hoặc mở ra chọn Theo hộp / Theo ống + quy cách */
export default function PackCell({ p, cell, onChange }: { p: CountP; cell: Cell | undefined; onChange: (c: Cell | undefined) => void }) {
  if (cell?.open) {
    return (
      <div className="rounded-xl bg-cream/60 p-2">
        <PackQty value={cell.pe} onChange={(pe) => onChange({ pe, open: true })} allowLoose product={p} volUnit={volumeUnit(p.capacity, p.unit) === "g" ? "g" : "ml"} />
      </div>
    );
  }
  const v = cell?.pe.loose ?? "";
  return (
    <span className="flex shrink-0 items-center gap-1 text-xs">
      <input
        type="number"
        min={0}
        inputMode="numeric"
        className="w-16 rounded-lg border border-beige-dark px-2 py-1.5 text-right text-sm"
        placeholder="0"
        value={v}
        onChange={(e) => onChange(e.target.value === "" && !cell ? undefined : { pe: { ...(cell?.pe ?? initPack(p)), mode: "unit", loose: e.target.value }, open: false })}
      />
      {p.unit}
      <button
        type="button"
        className="ml-1 rounded-full bg-cream px-2 py-1 font-semibold text-navy ring-1 ring-beige-dark"
        title="Đếm theo hộp hoặc sửa quy cách (ống / hộp, ml / ống)"
        onClick={() => onChange({ pe: { ...initPack(p), loose: cell?.pe.loose ?? "" }, open: true })}
      >
        Hộp/ống
      </button>
    </span>
  );
}

export const cellTotal = (c: Cell | undefined) => (c ? packTotal(c.pe, true) : null);
export const cellUsed = (c: Cell | undefined) => !!c && (c.pe.mode === "box" ? c.pe.boxes !== "" || c.pe.loose !== "" : c.pe.loose !== "");

/** Lưu quy cách mới của các sản phẩm đã đổi (trước khi gửi phiếu kiểm). Trả lỗi đầu tiên nếu có. */
export async function savePackChanges(products: CountP[], cells: Record<string, Cell>): Promise<string | null> {
  const supabase = createClient();
  for (const p of products) {
    const c = cells[p.id];
    if (!c || !c.open) continue;
    const err = packError(c.pe, p);
    if (err) return `${p.label}: ${err}`;
    const ch = packChange(p, c.pe);
    if (!ch) continue;
    const { error } = await supabase.rpc("set_product_pack", { p_id: p.id, ...ch });
    if (error) return `${p.label}: ${vnError(error.message)}`;
  }
  return null;
}

export function useCells() {
  const [cells, setCells] = useState<Record<string, Cell>>({});
  const setCell = (id: string, c: Cell | undefined) =>
    setCells((x) => {
      const n = { ...x };
      if (c) n[id] = c;
      else delete n[id];
      return n;
    });
  return { cells, setCells, setCell };
}
