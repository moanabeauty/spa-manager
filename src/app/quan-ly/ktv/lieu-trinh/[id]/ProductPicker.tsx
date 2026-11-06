"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cleanBarcode } from "@/lib/inventory";
import CameraScanner from "@/components/CameraScanner";

type P = { id: string; name: string; brand: string | null; capacity: string | null; sku: string | null; barcode: string | null; for_retail: boolean };
const COLS = "id, name, brand, capacity, sku, barcode, for_retail";

/** Hiển thị: NHÃN HÀNG Tên · dung tích (giống cách ghi trong quy trình gốc) */
export function productLabel(p: P) {
  const brand = p.brand?.trim();
  const name = brand && !p.name.toLowerCase().startsWith(brand.toLowerCase()) ? `${brand} ${p.name}` : p.name;
  return [name, p.capacity].filter(Boolean).join(" · ");
}

/**
 * Ô "Đổi sang sản phẩm": gõ tên / nhãn hàng / mã → hiện danh sách sản phẩm trong kho để chọn,
 * hoặc bấm 📷 quét mã vạch trên vỏ hộp. Vẫn gõ tay được nếu sản phẩm chưa có trong hệ thống.
 */
export default function ProductPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [hits, setHits] = useState<P[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const picked = useRef(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (picked.current) {
      picked.current = false;
      return;
    }
    const t = value.trim();
    if (t.length < 2) {
      setHits(null);
      return;
    }
    setBusy(true);
    const id = setTimeout(async () => {
      const q = t.replace(/[%,()]/g, " ");
      const { data } = await createClient()
        .from("products")
        .select(COLS)
        .eq("is_active", true)
        .or(`name.ilike.%${q}%,brand.ilike.%${q}%,sku.ilike.${q}%,barcode.ilike.%${q}%`)
        .order("for_retail") // hàng dùng liệu trình lên trước
        .order("name")
        .limit(12);
      setHits((data ?? []) as P[]);
      setBusy(false);
    }, 250);
    return () => clearTimeout(id);
  }, [value]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function pick(p: P) {
    picked.current = true;
    onChange(productLabel(p));
    setOpen(false);
    setMsg(null);
  }

  async function onScan(raw: string) {
    setScanning(false);
    const code = cleanBarcode(raw);
    if (!code) return;
    setMsg(null);
    const alt = /^\d{12}$/.test(code) ? `0${code}` : code;
    const { data } = await createClient().from("products").select(COLS).eq("is_active", true).in("barcode", [code, alt]).limit(2);
    const list = (data ?? []) as P[];
    if (list.length === 1) pick(list[0]);
    else if (list.length > 1) {
      setHits(list);
      setOpen(true);
    } else setMsg(`Mã ${code} chưa gắn cho sản phẩm nào – gõ tên sản phẩm để tìm, hoặc báo kho gắn mã.`);
  }

  return (
    <div ref={box} className="relative">
      <input
        className="input py-2 pr-12 text-sm"
        placeholder="Đổi sang sản phẩm… (gõ tên hoặc quét mã)"
        value={value}
        autoFocus
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setMsg(null);
        }}
        onFocus={() => setOpen(true)}
      />
      <button
        type="button"
        aria-label="Quét mã vạch sản phẩm"
        title="Quét mã vạch sản phẩm"
        className="absolute right-1 top-1/2 -translate-y-1/2 rounded-lg px-2.5 py-1 text-lg hover:bg-cream"
        onClick={() => {
          setMsg(null);
          setScanning(true);
        }}
      >
        📷
      </button>
      {scanning && <CameraScanner closeOnScan onScan={onScan} onClose={() => setScanning(false)} />}
      {msg && <p className="mt-1 text-xs text-[#8C1D18]">{msg}</p>}
      {open && value.trim().length >= 2 && (
        <div className="absolute inset-x-0 top-full z-40 mt-1 max-h-64 overflow-y-auto rounded-xl border border-beige-dark bg-white shadow-lg">
          {busy && !hits && <p className="px-3 py-2 text-xs text-ink/60">Đang tìm…</p>}
          {hits && hits.length === 0 && (
            <p className="px-3 py-2 text-xs text-ink/60">Không thấy sản phẩm trong kho – vẫn gửi được với tên đã gõ.</p>
          )}
          {hits?.map((p) => (
            <button key={p.id} type="button" onClick={() => pick(p)} className="block w-full border-b border-cream px-3 py-2 text-left text-sm last:border-0 hover:bg-cream">
              <span className="font-medium">{productLabel(p)}</span>
              <span className="block text-[11px] text-ink/55">
                {[p.sku, p.for_retail ? "Hàng bán lẻ" : "Dùng liệu trình"].filter(Boolean).join(" · ")}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
