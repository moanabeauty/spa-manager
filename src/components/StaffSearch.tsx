"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cleanBarcode } from "@/lib/inventory";
import { formatVnd } from "@/lib/format";
import CameraScanner from "./LazyCameraScanner";

type Hit = {
  kind: "customer" | "invoice" | "product" | "service";
  id: string;
  title: string;
  subtitle: string | null;
  capacity?: string | null;
  brand?: string | null;
  list_price?: number | null;
  min_price?: number | null;
  avg_cost?: number | null;
};
const KIND: Record<Hit["kind"], { label: string; href: (id: string) => string }> = {
  customer: { label: "Khách hàng", href: (id) => `/quan-ly/khach-hang?id=${id}` },
  invoice: { label: "Hoá đơn / đơn ship", href: (id) => `/quan-ly/hoa-don/${id}` },
  product: { label: "Sản phẩm", href: (id) => `/quan-ly/kho/san-pham/${id}` },
  service: { label: "Liệu trình", href: (id) => `/quan-ly/lieu-trinh-goc/${id}` },
};

/** Ô tìm kiếm chung: liệu trình, tên / SĐT khách, mã hoá đơn, mã vận đơn, sản phẩm (tên, mã, mã vạch) */
export default function StaffSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const drop = useRef<HTMLDivElement>(null);
  // vị trí khung kết quả: vẽ ra ngoài thanh trên cùng (portal) vì trên iPhone, phần tràn ra khỏi
  // thanh có hiệu ứng mờ (backdrop-blur) hiển thị được nhưng bấm không ăn
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);

  // Quét mã vạch: tìm đúng 1 sản phẩm thì mở thẳng trang sản phẩm, còn lại hiện kết quả như gõ tìm
  async function onScan(raw: string) {
    const code = cleanBarcode(raw);
    setScanning(false);
    if (!code) return;
    setScanBusy(true);
    setScanMsg(null);
    const { data } = await createClient().rpc("staff_search_v3", { p_q: code });
    setScanBusy(false);
    const products = ((data ?? []) as Hit[]).filter((h) => h.kind === "product");
    if (products.length === 1) {
      setQ("");
      setOpen(false);
      router.push(KIND.product.href(products[0].id));
    } else if (products.length === 0) {
      setScanMsg(`Mã ${code} chưa gắn cho sản phẩm nào. Vào Sản phẩm → mở sản phẩm → ô Mã vạch để gắn.`);
    } else {
      setQ(code);
      setOpen(true);
    }
  }

  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) {
      setHits(null);
      return;
    }
    setBusy(true);
    let alive = true; // gõ tiếp thì bỏ kết quả cũ về muộn (tránh hiện sai kết quả)
    const id = setTimeout(async () => {
      const sb = createClient();
      const { data } = await sb.rpc("staff_search_v3", { p_q: t });
      if (!alive) return;
      let list = (data ?? []) as Hit[];
      // giá nhập trung bình: chỉ tài khoản Chủ nhận được số (người khác hàm trả về rỗng)
      const ids = list.filter((h) => h.kind === "product").map((h) => h.id);
      if (ids.length) {
        const { data: costs } = await sb.rpc("product_avg_costs", { p_ids: ids });
        if (!alive) return;
        const m = new Map(((costs ?? []) as { product_id: string; avg_cost: number | null }[]).map((c) => [c.product_id, c.avg_cost]));
        if (m.size) list = list.map((h) => (m.has(h.id) ? { ...h, avg_cost: m.get(h.id) } : h));
      }
      setHits(list);
      setBusy(false);
    }, 250);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [q]);

  useEffect(() => {
    const close = (e: Event) => {
      const t = e.target as Node;
      if (box.current?.contains(t) || drop.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const showDrop = open && q.trim().length >= 2;
  useLayoutEffect(() => {
    if (!showDrop) return;
    const place = () => {
      const r = box.current?.getBoundingClientRect();
      if (!r || r.width === 0) return setPos(null); // ô đang ẩn (bản máy tính / điện thoại)
      setPos({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", place);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.visualViewport?.removeEventListener("resize", place);
    };
  }, [showDrop]);

  function go(h: Hit) {
    setOpen(false);
    setQ("");
    router.push(KIND[h.kind].href(h.id));
  }
  function picked() {
    setOpen(false);
    setQ("");
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  const groups = (["service", "customer", "invoice", "product"] as const).map((k) => ({ k, items: (hits ?? []).filter((h) => h.kind === k) }));

  return (
    <div ref={box} className="relative">
      <input
        type="search"
        className="input py-2 pl-9 pr-12 text-base sm:text-sm"
        placeholder="Tìm liệu trình, khách, SĐT, mã hoá đơn, sản phẩm…"
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
      <button
        type="button"
        aria-label="Quét mã vạch sản phẩm"
        title="Quét mã vạch sản phẩm"
        className="absolute right-1 top-1/2 -translate-y-1/2 rounded-lg px-2.5 py-1 text-lg hover:bg-cream disabled:opacity-50"
        disabled={scanBusy}
        onClick={() => {
          setScanMsg(null);
          setScanning(true);
        }}
      >
        {scanBusy ? "…" : "📷"}
      </button>
      {scanMsg && (
        <div className="absolute inset-x-0 top-full z-50 mt-1 rounded-xl border border-beige-dark bg-white px-4 py-3 text-sm shadow-lg">
          {scanMsg}
          <button className="ml-2 text-xs font-semibold text-navy underline" onClick={() => setScanMsg(null)}>Đóng</button>
        </div>
      )}
      {scanning && <CameraScanner closeOnScan onScan={onScan} onClose={() => setScanning(false)} />}
      {showDrop && pos && typeof document !== "undefined" &&
        createPortal(
          <div
            ref={drop}
            style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, maxHeight: `calc(100dvh - ${Math.round(pos.top) + 12}px)` }}
            className="z-[60] overflow-y-auto overscroll-contain rounded-xl border border-beige-dark bg-surface shadow-lg"
          >
            {busy && !hits && <p className="px-4 py-3 text-sm text-ink/60">Đang tìm…</p>}
            {hits && hits.length === 0 && <p className="px-4 py-3 text-sm text-ink/60">Không tìm thấy “{q.trim()}”.</p>}
            {groups.map(
              (g) =>
                g.items.length > 0 && (
                  <div key={g.k} className="border-b border-beige last:border-0">
                    <p className="px-4 pt-2 text-[11px] font-bold uppercase tracking-wide text-brown">{KIND[g.k].label}</p>
                    {g.items.map((h) => (
                      <Link key={h.id} href={KIND[h.kind].href(h.id)} onClick={picked} className="block w-full px-4 py-2 text-left text-sm hover:bg-cream">
                        <span className="font-medium">{h.title}</span>
                        {h.kind === "product" ? (
                          <ProductLine h={h} />
                        ) : (
                          <>
                            {h.subtitle && <span className="block text-xs text-ink/60">{h.subtitle}</span>}
                            {h.kind === "service" && h.list_price != null && (
                              <span className="block text-xs text-ink/60">
                                Niêm yết {formatVnd(Number(h.list_price))}
                                {h.min_price != null ? ` · Member ${formatVnd(Number(h.min_price))}` : ""}
                              </span>
                            )}
                          </>
                        )}
                      </Link>
                    ))}
                  </div>
                ),
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

/** Dòng gợi ý sản phẩm: Dung tích · Nhãn hàng, rồi Giá niêm yết · Giá bán thấp nhất của KTV (chỉ hàng bán lẻ) · Giá nhập TB (chỉ Chủ) */
function ProductLine({ h }: { h: Hit }) {
  const info = [h.capacity, h.brand].filter(Boolean).join(" · ");
  const hasPrice = h.list_price != null;
  return (
    <>
      {info && <span className="block text-xs text-ink/60">{info}</span>}
      {hasPrice ? (
        <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs">
          <span>
            Niêm yết: <b className="text-navy">{formatVnd(Number(h.list_price))}</b>
          </span>
          {h.min_price != null && (
            <span>
              KTV bán thấp nhất: <b className="text-brown">{formatVnd(Number(h.min_price))}</b>
            </span>
          )}
        </span>
      ) : (
        h.subtitle && <span className="block text-xs italic text-ink/50">{h.subtitle}</span>
      )}
      {h.avg_cost !== undefined && (
        <span className="mt-0.5 block text-xs">
          Giá nhập TB: <b className="text-[#8A2323]">{h.avg_cost != null ? formatVnd(Number(h.avg_cost)) : "chưa có"}</b>
        </span>
      )}
    </>
  );
}
