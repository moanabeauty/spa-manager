"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatVnd } from "@/lib/format";

type Hit = { id: string; title: string; subtitle: string | null; list_price: number | null; member_price: number | null; has_guide: boolean };

/** Ô tìm liệu trình của KTV: bấm vào kết quả → Chỉ định · Chỉ định mở rộng · Hướng dẫn tư vấn · Quy trình */
export default function KtvServiceSearch() {
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
      const { data } = await createClient().rpc("service_search", { p_q: t });
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
    router.push(`/quan-ly/lieu-trinh-goc/${h.id}`);
  }

  return (
    <div ref={box} className="relative">
      <input
        type="search"
        className="w-full rounded-xl border-0 bg-white py-2.5 pl-9 pr-3 text-sm text-ink placeholder:text-ink/45"
        placeholder="Tìm liệu trình: chỉ định, tư vấn, quy trình…"
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
          {hits && hits.length === 0 && <p className="px-4 py-3 text-sm text-ink/60">Không tìm thấy liệu trình “{q.trim()}”.</p>}
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
        </div>
      )}
    </div>
  );
}
