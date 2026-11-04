"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatVnd } from "@/lib/format";

export type CustomerHit = {
  id: string;
  code: string;
  full_name: string;
  phone: string | null;
  note: string | null;
  home_branch_id: string | null;
  packages_left: number;
  card_balance: number;
  last_visit: string | null;
};

function shortDate(iso: string) {
  return new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "2-digit" }).format(new Date(iso));
}

/**
 * Ô tìm khách: gõ SĐT, mã KH (KH00012 hoặc 12) hoặc tên (không cần dấu) → gợi ý ngay bên dưới.
 * Dùng phím ↑ ↓ + Enter hoặc bấm để chọn.
 */
export default function CustomerSearch({
  onPick,
  onQueryChange,
  initialQuery = "",
  placeholder = "Gõ SĐT, mã KH hoặc tên khách…",
  autoFocus,
  emptyHint,
  label,
}: {
  onPick: (c: CustomerHit) => void;
  /** báo lại chữ đang gõ + kết quả (để trang cha xử lý khách mới) */
  onQueryChange?: (q: string, hits: CustomerHit[] | null) => void;
  initialQuery?: string;
  placeholder?: string;
  autoFocus?: boolean;
  /** hiện khi không có kết quả (vd: hướng dẫn tạo khách mới) */
  emptyHint?: React.ReactNode;
  label?: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [q, setQ] = useState(initialQuery);
  const [hits, setHits] = useState<CustomerHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(!!initialQuery);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const report = useRef(onQueryChange);
  report.current = onQueryChange;

  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) {
      setHits(null);
      report.current?.(q, null);
      return;
    }
    let cancelled = false;
    setBusy(true);
    const id = setTimeout(async () => {
      const { data } = await supabase.rpc("search_customers", { p_q: t, p_limit: 8 });
      if (cancelled) return;
      const list = ((data ?? []) as CustomerHit[]).map((c) => ({ ...c, card_balance: Number(c.card_balance) }));
      setHits(list);
      setActive(0);
      setBusy(false);
      report.current?.(q, list);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [q, supabase]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function pick(c: CustomerHit) {
    setOpen(false);
    setQ("");
    setHits(null);
    onPick(c);
  }

  return (
    <div ref={box} className="relative">
      {label && <span className="label">{label}</span>}
      <input
        type="search"
        className="input"
        placeholder={placeholder}
        value={q}
        autoFocus={autoFocus}
        autoComplete="off"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!hits?.length) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, hits.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(hits[active] ?? hits[0]);
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && q.trim().length >= 2 && (busy || hits) && (
        <div className="absolute inset-x-0 top-full z-40 mt-1 max-h-80 overflow-y-auto rounded-xl border border-beige-dark bg-white shadow-lg">
          {busy && !hits && <p className="px-4 py-3 text-sm text-ink/60">Đang tìm…</p>}
          {hits && hits.length === 0 && (
            <div className="px-4 py-3 text-sm text-ink/60">{emptyHint ?? <>Không tìm thấy khách “{q.trim()}”.</>}</div>
          )}
          {hits?.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(c)}
              className={`block w-full border-b border-beige px-4 py-2.5 text-left text-sm last:border-0 ${i === active ? "bg-cream" : "bg-white"}`}
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="font-semibold">{c.full_name}</span>
                <span className="shrink-0 text-ink/60">{c.phone ?? "—"}</span>
              </span>
              <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink/60">
                <span className="font-mono text-brown">{c.code}</span>
                {c.packages_left > 0 && <span className="text-[#22612A]">còn {c.packages_left} buổi gói</span>}
                {c.card_balance > 0 && <span className="text-navy">thẻ {formatVnd(c.card_balance)}</span>}
                {c.last_visit ? <span>lần cuối {shortDate(c.last_visit)}</span> : <span>chưa làm lần nào</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
