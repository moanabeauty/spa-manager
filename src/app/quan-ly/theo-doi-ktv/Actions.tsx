"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { vnError } from "@/lib/format";

/** Tự tải lại trang để quản lý theo dõi tiến độ KTV gần như thời gian thực */
export function AutoRefresh({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    // chỉ tải lại khi màn hình đang mở (khoá máy / chuyển app thì dừng, mở lại thì tải ngay)
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, seconds]);
  return null;
}

/** Nút Duyệt / Không duyệt cho các yêu cầu của KTV */
export function ReviewButtons({ fn, args, withNote }: { fn: string; args: Record<string, unknown>; withNote?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function go(approve: boolean) {
    setBusy(true);
    setError(null);
    const { error: e } = await createClient().rpc(fn, { ...args, p_approve: approve, ...(withNote ? { p_note: note.trim() || null } : {}) });
    setBusy(false);
    if (e) return setError(vnError(e.message));
    router.refresh();
  }
  return (
    <div className="mt-2 space-y-1.5">
      {withNote && (
        <input className="w-full rounded-lg border border-beige-dark px-3 py-1.5 text-sm" placeholder="Ghi chú cho KTV (không bắt buộc)" value={note} onChange={(e) => setNote(e.target.value)} />
      )}
      <div className="flex gap-2">
        <button className="btn-primary flex-1 py-1.5" disabled={busy} onClick={() => go(true)}>Duyệt</button>
        <button className="btn-outline flex-1 py-1.5" disabled={busy} onClick={() => go(false)}>Không duyệt</button>
      </div>
      {error && <p className="text-xs text-[#8A2323]">{error}</p>}
    </div>
  );
}
