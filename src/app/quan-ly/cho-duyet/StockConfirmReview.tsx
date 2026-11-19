"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatVnd, vnError } from "@/lib/format";
import { OPEN_LEVELS, fmtQty } from "@/lib/inventory";

const LEVELS = [{ pct: 100, label: "Nguyên chai" }, ...OPEN_LEVELS];

type Opt = {
  product_id: string; label: string; sku: string | null; unit: string; stock: number; same: boolean;
  need: number; unit_cost: number | null; session_cost: number | null; current_cost: number | null;
};

/**
 * KTV chưa hoàn thành được buổi vì chai đang mở không đủ:
 * - Xác nhận còn hàng (chỉ chủ spa): chọn mức còn của chai thực tế → thành chai đang mở.
 * - Duyệt mở lọ mới (chủ / quản lý): tìm sản phẩm còn tồn trong kho → xuất 1 lọ mới; khác sản phẩm thì buổi này đổi sang sản phẩm mới,
 *   cost tính theo giá nhập của lọ mới. Chỉ chủ spa thấy giá nhập / cost.
 */
export default function StockConfirmReview({ id, isOwner }: { id: string; isOwner: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"confirm" | "bottle">(isOwner ? "confirm" : "bottle");
  const [pct, setPct] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState<Opt[] | null>(null);
  const [pick, setPick] = useState<Opt | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "bottle") return;
    const t = setTimeout(async () => {
      const { data, error: e } = await createClient().rpc("confirm_bottle_options", { p_id: id, p_q: q.trim() || null });
      if (e) return setError(vnError(e.message));
      setOpts((data ?? []) as Opt[]);
    }, 250);
    return () => clearTimeout(t);
  }, [mode, q, id]);

  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true);
    setError(null);
    const { error: e } = await fn();
    setBusy(false);
    if (e) return setError(vnError(e.message));
    router.refresh();
  }

  const sb = () => createClient();
  const confirm = () => {
    if (pct == null) return setError("Chọn mức còn của chai.");
    run(() => sb().rpc("review_stock_confirm", { p_id: id, p_approve: true, p_pct: pct, p_note: note.trim() || null }));
  };
  const openBottle = () => {
    if (!pick) return setError("Chọn sản phẩm để mở lọ mới.");
    run(() => sb().rpc("approve_open_new_bottle", { p_id: id, p_product: pick.product_id, p_note: note.trim() || null }));
  };
  const reject = () => run(() => sb().rpc("review_stock_confirm", { p_id: id, p_approve: false, p_pct: null, p_note: note.trim() || null }));

  const tab = (m: typeof mode, label: string) => (
    <button
      type="button"
      onClick={() => { setMode(m); setError(null); }}
      className={`flex-1 rounded-full px-3 py-1.5 text-xs font-semibold ${mode === m ? "bg-navy text-white" : "text-navy"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="mt-2 space-y-1.5">
      {isOwner && (
        <div className="flex gap-1 rounded-full bg-cream p-0.5">
          {tab("confirm", "Xác nhận còn hàng")}
          {tab("bottle", "Duyệt mở lọ mới")}
        </div>
      )}

      {mode === "confirm" ? (
        <>
          <p className="text-xs text-ink/70">Chai thực tế còn:</p>
          <div className="flex flex-wrap gap-1.5">
            {LEVELS.map((l) => (
              <button
                key={l.pct}
                type="button"
                onClick={() => setPct(l.pct)}
                className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${pct === l.pct ? "bg-navy text-white ring-navy" : "bg-white text-navy ring-beige-dark"}`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="text-xs text-ink/70">Chọn sản phẩm trong kho để mở lọ mới (khác sản phẩm thì buổi này đổi sang sản phẩm mới, cùng định lượng):</p>
          <input
            className="w-full rounded-lg border border-beige-dark px-3 py-1.5 text-sm"
            placeholder="Tìm tên / nhãn hàng / mã sản phẩm…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="max-h-60 space-y-1 overflow-y-auto">
            {opts == null && <p className="text-xs text-ink/60">Đang tìm…</p>}
            {opts?.length === 0 && <p className="text-xs text-ink/60">Không có sản phẩm còn tồn trong kho liệu trình của chi nhánh khớp tìm kiếm.</p>}
            {opts?.map((o) => {
              const on = pick?.product_id === o.product_id;
              return (
                <button
                  key={o.product_id}
                  type="button"
                  onClick={() => setPick(o)}
                  className={`block w-full rounded-lg px-2.5 py-1.5 text-left text-xs ring-1 ${on ? "bg-navy text-white ring-navy" : "bg-white ring-beige-dark"}`}
                >
                  <span className="font-semibold">{o.label}</span>
                  {o.same && <span className="ml-1 rounded bg-[#D6EDD8] px-1 text-[10px] font-semibold text-[#22612A]">cùng sản phẩm</span>}
                  <span className={`block text-[11px] ${on ? "text-white/80" : "text-ink/60"}`}>
                    Tồn kho {fmtQty(o.stock)}
                    {o.sku ? ` · ${o.sku}` : ""}
                    {isOwner && o.unit_cost != null ? ` · giá nhập ${formatVnd(o.unit_cost)}` : ""}
                    {isOwner && o.session_cost != null ? ` · cost buổi này ${formatVnd(o.session_cost)}` : ""}
                  </span>
                </button>
              );
            })}
          </div>
          {pick && (
            <p className="rounded-lg bg-cream px-2.5 py-1.5 text-xs">
              Mở 1 lọ mới <b>{pick.label}</b> · trừ buổi này {fmtQty(pick.need)} {pick.unit}
              {isOwner && pick.session_cost != null && (
                <>
                  {" "}· cost: {pick.current_cost != null && !pick.same ? <>{formatVnd(pick.current_cost)} → </> : null}
                  <b>{formatVnd(pick.session_cost)}</b>
                </>
              )}
            </p>
          )}
        </>
      )}

      <input className="w-full rounded-lg border border-beige-dark px-3 py-1.5 text-sm" placeholder="Ghi chú cho KTV (không bắt buộc)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex gap-2">
        {mode === "confirm" ? (
          <button className="btn-primary flex-1 py-1.5" disabled={busy} onClick={confirm}>Xác nhận còn hàng</button>
        ) : (
          <button className="btn-primary flex-1 py-1.5" disabled={busy || !pick} onClick={openBottle}>Duyệt mở lọ mới</button>
        )}
        <button className="btn-outline flex-1 py-1.5" disabled={busy} onClick={reject}>Không duyệt</button>
      </div>
      {error && <p className="text-xs text-[#8A2323]">{error}</p>}
    </div>
  );
}
