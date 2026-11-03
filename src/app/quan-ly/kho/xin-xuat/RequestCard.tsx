"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatTime, vnError } from "@/lib/format";
import { REQUEST_STATUS_LABEL, REQUEST_STATUS_STYLE } from "@/lib/inventory";

export type StockRequest = {
  id: string;
  code: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  reason: string | null;
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
  requested_by: string;
  warehouse_id: string;
  warehouses: { name: string; branch_id: string } | null;
  requester: { full_name: string | null } | null;
  reviewer: { full_name: string | null } | null;
  stock_request_items: { quantity: number; product_id: string; products: { name: string; capacity: string | null; unit: string } | null }[];
};

function when(iso: string) {
  return `${formatTime(iso)} ${new Date(iso).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit" })}`;
}

export default function RequestCard({
  req: r,
  branchName,
  canReview,
  canCancel,
  compact,
}: {
  req: StockRequest;
  branchName: string;
  canReview: boolean;
  canCancel: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(fn: string, args: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const { error } = await createClient().rpc(fn, args);
    setBusy(false);
    if (error) return setError(vnError(error.message));
    router.refresh();
  }

  return (
    <div className={`card p-4 text-sm ${r.status === "pending" ? "border-l-4 border-l-[#E0A526]" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">
            {r.code} · {r.requester?.full_name ?? "?"}
          </p>
          <p className="text-xs text-ink/55">
            {when(r.created_at)} · {branchName || r.warehouses?.name}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${REQUEST_STATUS_STYLE[r.status]}`}>
          {REQUEST_STATUS_LABEL[r.status]}
        </span>
      </div>
      <ul className={`mt-2 ${compact ? "text-xs" : ""}`}>
        {r.stock_request_items.map((i) => (
          <li key={i.product_id} className="flex justify-between gap-3 py-0.5">
            <span>
              {i.products?.name}
              {i.products?.capacity ? ` · ${i.products.capacity}` : ""}
            </span>
            <b className="shrink-0">
              {i.quantity} {i.products?.unit}
            </b>
          </li>
        ))}
      </ul>
      {r.reason && <p className="mt-1 text-xs text-ink/70">Dùng cho: {r.reason}</p>}
      {r.status !== "pending" && r.status !== "cancelled" && (
        <p className="mt-1 text-xs text-ink/55">
          {r.reviewer?.full_name ?? ""} {r.status === "approved" ? "duyệt" : "từ chối"}
          {r.reviewed_at ? ` lúc ${when(r.reviewed_at)}` : ""}
          {r.review_note ? ` – ${r.review_note}` : ""}
        </p>
      )}

      {r.status === "pending" && (canReview || canCancel) && (
        <div className="mt-3 space-y-2 border-t border-beige pt-3">
          {canReview && (
            <input
              className="w-full rounded-lg border border-beige-dark px-2 py-1.5 text-sm"
              placeholder="Ghi chú (bắt buộc khi từ chối)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          )}
          {error && <p className="text-xs text-[#8A2323]">{error}</p>}
          <div className="flex justify-end gap-2">
            {canCancel && (
              <button className="btn-ghost py-2 text-ink/60" disabled={busy} onClick={() => call("cancel_stock_request", { p_id: r.id })}>
                Huỷ phiếu
              </button>
            )}
            {canReview && (
              <>
                <button
                  className="btn-ghost py-2 text-[#8A2323]"
                  disabled={busy || !note.trim()}
                  title={note.trim() ? "" : "Ghi lý do từ chối"}
                  onClick={() => call("review_stock_request", { p_id: r.id, p_approve: false, p_note: note })}
                >
                  Từ chối
                </button>
                <button
                  className="btn-primary py-2"
                  disabled={busy}
                  onClick={() => call("review_stock_request", { p_id: r.id, p_approve: true, p_note: note })}
                >
                  Duyệt & xuất kho
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
