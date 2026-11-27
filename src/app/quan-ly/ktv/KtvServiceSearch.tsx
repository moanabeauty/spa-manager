"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatVnd } from "@/lib/format";
import { productLabel, retailMinPrice } from "@/lib/inventory";

type Hit = { id: string; title: string; subtitle: string | null; list_price: number | null; member_price: number | null; has_guide: boolean };
type ProdHit = {
  id: string;
  label: string;
  brand: string | null;
  unit: string;
  list: number | null;
  min: number | null;
  stock: number;
  reserved: number;
};

type ProdRow = {
  id: string; name: string; capacity: string | null; brand: string | null; unit: string; barcode: string | null;
  retail_price: number | null; max_staff_discount_pct: number | null;
};

let ctx: Promise<{ branch: string | null; pct: number }> | null = null; // chi nhánh của mình + % giảm tối đa mặc định (tải 1 lần)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadCtx(sb: any) {
  if (!ctx)
    ctx = (async () => {
      const { data: u } = await sb.auth.getUser();
      const [{ data: me }, { data: st }] = await Promise.all([
        sb.from("profiles").select("branch_id").eq("id", u?.user?.id ?? "").maybeSingle(),
        sb.from("app_settings").select("value").eq("key", "retail_staff_max_discount_pct").maybeSingle(),
      ]);
      const n = Number(st?.value ?? 0);
      return { branch: (me?.branch_id as string | null) ?? null, pct: Number.isFinite(n) ? n : 0 };
    })().catch(() => {
      ctx = null;
      return { branch: null, pct: 0 };
    });
  return ctx;
}

/** Sản phẩm bán lẻ: giá niêm yết · giá bán thấp nhất của KTV · tồn kho bán lẻ chi nhánh mình (trừ hàng đã lên đơn online) */
async function searchProducts(t: string): Promise<ProdHit[]> {
  const sb = createClient();
  const k = t.replace(/[,()*%\\]/g, " ").trim();
  if (k.length < 2) return [];
  const code = k.replace(/\s/g, "");
  const ors = [`name.ilike.%${k}%`, `brand.ilike.%${k}%`, `sku.ilike.${k}%`];
  if (code.length >= 4) ors.push(`barcode.ilike.%${code}%`);
  const [{ branch, pct }, { data }] = await Promise.all([
    loadCtx(sb),
    sb.from("products")
      .select("id, name, capacity, brand, unit, barcode, retail_price, max_staff_discount_pct")
      .eq("is_active", true).eq("for_retail", true).is("deleted_at", null)
      .or(ors.join(","))
      .order("name").limit(10),
  ]);
  const rows = (data ?? []) as ProdRow[];
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  let lv = sb.from("stock_levels").select("product_id, branch_id, quantity").eq("warehouse_type", "retail").in("product_id", ids);
  if (branch) lv = lv.eq("branch_id", branch);
  const [{ data: levels }, { data: res }] = await Promise.all([lv, sb.rpc("online_reserved_stock")]);
  const stock = new Map<string, number>();
  ((levels ?? []) as { product_id: string; quantity: number }[]).forEach((l) => stock.set(l.product_id, (stock.get(l.product_id) ?? 0) + Number(l.quantity)));
  const held = new Map<string, number>();
  ((res ?? []) as { product_id: string; branch_id: string; quantity: number }[])
    .filter((r) => !branch || r.branch_id === branch)
    .forEach((r) => held.set(r.product_id, (held.get(r.product_id) ?? 0) + Number(r.quantity)));
  // mã vạch khớp đúng lên đầu
  rows.sort((a, b) => Number(b.barcode === code) - Number(a.barcode === code));
  return rows.map((r) => ({
    id: r.id,
    label: productLabel(r),
    brand: r.brand,
    unit: r.unit,
    list: r.retail_price != null ? Number(r.retail_price) : null,
    min: r.retail_price != null ? retailMinPrice(Number(r.retail_price), r.max_staff_discount_pct, pct) : null,
    stock: stock.get(r.id) ?? 0,
    reserved: held.get(r.id) ?? 0,
  }));
}

/** Ô tìm của KTV: liệu trình (→ Chỉ định · Chỉ định mở rộng · Hướng dẫn tư vấn · Quy trình) + sản phẩm bán lẻ (giá niêm yết · giá thấp nhất · tồn kho) */
export default function KtvServiceSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [prods, setProds] = useState<ProdHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) {
      setHits(null);
      setProds([]);
      return;
    }
    setBusy(true);
    let alive = true; // gõ tiếp thì bỏ kết quả cũ về muộn (tránh hiện sai kết quả)
    const id = setTimeout(async () => {
      const [{ data }, ps] = await Promise.all([
        createClient().rpc("service_search", { p_q: t }),
        searchProducts(t).catch(() => [] as ProdHit[]),
      ]);
      if (!alive) return;
      setHits((data ?? []) as Hit[]);
      setProds(ps);
      setBusy(false);
    }, 250);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [q]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function go(h: Hit) {
    setOpen(false);
    setQ("");
    router.push(`/quan-ly/lieu-trinh-goc/${h.id}`);
  }

  return (
    <div ref={box} className="relative">
      <input
        type="search"
        className="w-full rounded-xl border-0 bg-white py-2.5 pl-9 pr-3 text-sm text-ink placeholder:text-ink/45"
        placeholder="Tìm liệu trình hoặc sản phẩm (giá, tồn kho)…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && hits?.length) go(hits[0]);
          if (e.key === "Escape") setOpen(false);
        }}
      />
      <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/40" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </svg>
      {open && q.trim().length >= 2 && (
        <div className="absolute inset-x-0 top-full z-50 mt-1 max-h-[65vh] overflow-y-auto rounded-xl border border-beige-dark bg-white text-ink shadow-lg">
          {busy && !hits && <p className="px-4 py-3 text-sm text-ink/60">Đang tìm…</p>}
          {hits && hits.length === 0 && prods.length === 0 && <p className="px-4 py-3 text-sm text-ink/60">Không tìm thấy liệu trình / sản phẩm “{q.trim()}”.</p>}
          {hits && hits.length > 0 && prods.length > 0 && (
            <p className="bg-cream px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-brown">Liệu trình</p>
          )}
          {hits?.map((h) => (
            <button key={h.id} onClick={() => go(h)} className="block w-full border-b border-beige px-4 py-2.5 text-left text-sm last:border-0 hover:bg-cream">
              <span className="font-semibold text-navy">{h.title}</span>
              {h.subtitle && <span className="block text-xs text-ink/60">{h.subtitle}</span>}
              {h.list_price != null && (
                <span className="block text-xs text-ink/60">
                  Niêm yết {formatVnd(Number(h.list_price))}
                  {h.member_price != null ? ` · Member ${formatVnd(Number(h.member_price))}` : ""}
                </span>
              )}
              {h.has_guide && <span className="block text-[11px] font-semibold text-brown">Chỉ định · Tư vấn · Quy trình</span>}
            </button>
          ))}
          {prods.length > 0 && (
            <>
              <p className="bg-cream px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-brown">Sản phẩm bán lẻ</p>
              {prods.map((p) => {
                const sell = p.stock - p.reserved;
                return (
                  <button
                    key={p.id}
                    onClick={() => {
                      setOpen(false);
                      setQ("");
                      router.push(`/quan-ly/kho/san-pham/${p.id}`);
                    }}
                    className="block w-full border-b border-beige px-4 py-2.5 text-left text-sm last:border-0 hover:bg-cream"
                  >
                    <span className="font-semibold text-navy">{p.label}</span>
                    {p.brand && <span className="block text-xs text-ink/60">{p.brand}</span>}
                    <span className="mt-0.5 block text-xs text-ink/70">
                      Niêm yết <b className="text-navy">{p.list != null ? formatVnd(p.list) : "—"}</b>
                      {p.min != null && <> · Thấp nhất <b className="text-[#8A2323]">{formatVnd(p.min)}</b></>}
                    </span>
                    <span className={`block text-xs font-semibold ${p.stock <= 0 ? "text-[#8A2323]" : "text-[#22612A]"}`}>
                      {p.stock <= 0 ? "Hết hàng" : `Tồn kho ${p.stock} ${p.unit}`}
                      {p.reserved > 0 && <span className="font-normal text-[#7A5600]"> · đã lên đơn {p.reserved}, còn bán {sell}</span>}
                    </span>
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
