"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Hit = { kind: "customer" | "invoice" | "product"; id: string; title: string; subtitle: string | null };
const KIND: Record<Hit["kind"], { label: string; href: (id: string) => string }> = {
  customer: { label: "Khách hàng", href: (id) => `/quan-ly/khach-hang?id=${id}` },
  invoice: { label: "Hoá đơn / đơn ship", href: (id) => `/quan-ly/hoa-don/${id}` },
  product: { label: "Sản phẩm", href: (id) => `/quan-ly/kho/san-pham/${id}` },
};

/** Ô tìm kiếm chung: tên / SĐT khách, mã hoá đơn, mã vận đơn, sản phẩm (tên, mã, mã vạch) */
export default function StaffSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) {
      setHits(null);
      return;
    }
    setBusy(true);
    const id = setTimeout(async () => {
      const { data } = await createClient().rpc("staff_search", { p_q: t });
      setHits((data ?? []) as Hit[]);
      setBusy(false);
    }, 250);
    return () => clearTimeout(id);
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
    router.push(KIND[h.kind].href(h.id));
  }

  const groups = (["customer", "invoice", "product"] as const).map((k) => ({ k, items: (hits ?? []).filter((h) => h.kind === k) }));

  return (
    <div ref={box} className="relative">
      <input
        type="search"
        className="input py-2 pl-9 text-sm"
        placeholder="Tìm khách, SĐT, mã hoá đơn, mã vận đơn, sản phẩm…"
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
        <div className="absolute inset-x-0 top-full z-50 mt-1 max-h-[70vh] overflow-y-auto rounded-xl border border-beige-dark bg-white shadow-lg">
          {busy && !hits && <p className="px-4 py-3 text-sm text-ink/60">Đang tìm…</p>}
          {hits && hits.length === 0 && <p className="px-4 py-3 text-sm text-ink/60">Không tìm thấy “{q.trim()}”.</p>}
          {groups.map(
            (g) =>
              g.items.length > 0 && (
                <div key={g.k} className="border-b border-beige last:border-0">
                  <p className="px-4 pt-2 text-[11px] font-bold uppercase tracking-wide text-brown">{KIND[g.k].label}</p>
                  {g.items.map((h) => (
                    <button key={h.id} onClick={() => go(h)} className="block w-full px-4 py-2 text-left text-sm hover:bg-cream">
                      <span className="font-medium">{h.title}</span>
                      {h.subtitle && <span className="block text-xs text-ink/60">{h.subtitle}</span>}
                    </button>
                  ))}
                </div>
              ),
          )}
        </div>
      )}
    </div>
  );
}
