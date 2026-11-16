"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { vnError } from "@/lib/format";

/** Chủ spa duyệt / từ chối combo quản lý tạo (cost cao hơn giá bán…). */
export default function PackageReview({ id }: { id: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function review(approve: boolean) {
    setBusy(true);
    setError(null);
    const { error } = await createClient().rpc("review_package", { p_id: id, p_approve: approve, p_note: note });
    setBusy(false);
    if (error) return setError(vnError(error.message));
    router.refresh();
  }

  return (
    <div className="mt-2 space-y-1.5">
      <input className="input py-1.5 text-sm" placeholder="Ghi chú (bắt buộc khi từ chối)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary px-3 py-1.5 text-sm" disabled={busy} onClick={() => review(true)}>
          ✓ Duyệt – cho bán
        </button>
        <button className="btn-ghost px-3 py-1.5 text-sm text-[#8A2323]" disabled={busy} onClick={() => review(false)}>
          Từ chối
        </button>
        <a href="/quan-ly/goi-combo" className="btn-ghost px-3 py-1.5 text-sm">
          Sửa giá / nội dung
        </a>
      </div>
      {error && <p className="text-xs text-[#8A2323]">{error}</p>}
    </div>
  );
}
