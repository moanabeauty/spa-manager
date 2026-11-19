"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatVnd } from "@/lib/format";
import { CUSTOMER_SEARCH_HINT, autoPickCustomer, customerQueryReady } from "@/lib/customerSearch";

type Hit = { id: string; code: string | null; full_name: string; phone: string | null; packages_left: number | null; card_balance: number | null };

/**
 * Tìm nhanh khách theo tên / mã KH / SĐT: gợi ý ngay khi gõ, bấm để mở hồ sơ.
 * Gõ đủ mã KH hoặc SĐT (hoặc tên chỉ ra đúng 1 khách) → tự mở hồ sơ khách đó.
 * Enter → lọc danh sách như trước.
 */
export default function CustomerQuickSearch({ defaultQ = "", autoOpen = true }: { defaultQ?: string; autoOpen?: boolean }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [q, setQ] = useState(defaultQ);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const typed = useRef(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!typed.current || !customerQueryReady(q)) {
      setHits(null);
      return;
    }
    let off = false;
    setBusy(true);
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc("search_customers", { p_q: q.trim(), p_limit: 8 });
      if (off) return;
      const list = (data ?? []) as Hit[];
      setHits(list);
      setBusy(false);
      const pick = autoOpen ? autoPickCustomer(q, list) : undefined;
      if (pick) open(pick.id);
    }, 300);
    return () => {
      off = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, supabase, autoOpen]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setShow(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function open(id: string) {
    typed.current = false;
    setShow(false);
    setHits(null);
    router.push(`/quan-ly/khach-hang?id=${id}`);
  }

  return (
    <div ref={box} className="relative min-w-0 flex-1">
      <input
        name="q"
        value={q}
        autoComplete="off"
        className="input py-2"
        placeholder={CUSTOMER_SEARCH_HINT}
        onChange={(e) => {
          typed.current = true;
          setQ(e.target.value);
          setShow(true);
        }}
        onFocus={() => setShow(true)}
      />
      {show && customerQueryReady(q) && (busy || hits) && (
        <div className="absolute inset-x-0 top-full z-40 mt-1 max-h-72 overflow-y-auto rounded-xl border border-beige-dark bg-white shadow-lg">
          {busy && !hits && <p className="px-3 py-2 text-xs text-ink/60">Đang tìm…</p>}
          {hits && hits.length === 0 && <p className="px-3 py-2 text-xs text-ink/60">Không thấy khách nào.</p>}
          {hits?.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => open(c.id)}
              className="block w-full border-b border-cream px-3 py-2 text-left text-sm last:border-0 hover:bg-cream"
            >
              <span className="font-medium">{c.full_name}</span>
              {c.code && <span className="ml-2 text-xs text-ink/55">{c.code}</span>}
              <span className="block text-[11px] text-ink/55">
                {[
                  c.phone,
                  Number(c.card_balance) > 0 ? `Thẻ ${formatVnd(Number(c.card_balance))}` : null,
                  Number(c.packages_left) > 0 ? `Còn ${c.packages_left} buổi combo` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
