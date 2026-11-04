"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { normalizeText, vnError } from "@/lib/format";
import { cleanBarcode } from "@/lib/inventory";
import CameraScanner from "@/components/CameraScanner";

type P = { id: string; label: string; brand: string | null; unit: string; barcode: string | null; qty: number };

export default function CountForm({ warehouseId, products }: { warehouseId: string; products: P[] }) {
  const router = useRouter();
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [onlyEntered, setOnlyEntered] = useState(false);
  const [note, setNote] = useState("");
  const [scan, setScan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const entered = Object.entries(counted).filter(([, v]) => v !== "" && Number.isInteger(Number(v)) && Number(v) >= 0);
  const diffs = entered.filter(([id, v]) => Number(v) !== (products.find((p) => p.id === id)?.qty ?? 0));
  const rows = useMemo(() => {
    const q = normalizeText(query.trim());
    return products
      .filter((p) => !q || normalizeText(`${p.brand ?? ""} ${p.label} ${p.barcode ?? ""}`).includes(q))
      .filter((p) => !onlyEntered || counted[p.id] !== undefined);
  }, [products, query, onlyEntered, counted]);

  function onScan(raw: string) {
    const c = cleanBarcode(raw);
    const p = products.find((x) => x.barcode === c);
    setScan(false);
    if (!p) return setMsg({ ok: false, text: `Không thấy sản phẩm có mã vạch ${c} trong kho này.` });
    setQuery(p.label);
    setCounted((x) => ({ ...x, [p.id]: String(Number(x[p.id] || 0) + 1) }));
    setMsg({ ok: true, text: `+1 ${p.label}` });
  }

  async function submit() {
    setBusy(true);
    setMsg(null);
    const { error } = await createClient().rpc("submit_stock_count", {
      p_warehouse_id: warehouseId,
      p_items: entered.map(([product_id, v]) => ({ product_id, counted: Number(v) })),
      p_note: note,
    });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: vnError(error.message) });
    setCounted({});
    setNote("");
    setMsg({ ok: true, text: diffs.length ? "Đã gửi phiếu kiểm kho. Phần lệch số sẽ cập nhật sau khi chủ spa duyệt." : "Đã lưu phiếu kiểm kho, số liệu khớp." });
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="card space-y-2 p-4 text-sm">
        <div className="flex gap-2">
          <input className="input min-w-0 flex-1 py-2" placeholder="Tìm sản phẩm / mã vạch…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button className="btn-outline shrink-0 py-2" onClick={() => setScan(!scan)}>📷 Quét</button>
        </div>
        {scan && <CameraScanner onScan={onScan} onClose={() => setScan(false)} />}
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={onlyEntered} onChange={(e) => setOnlyEntered(e.target.checked)} /> Chỉ hiện sản phẩm đã nhập số
        </label>
        <p className="text-xs text-ink/60">Quét mã vạch: mỗi lần quét +1 cho sản phẩm đó. Ô bỏ trống = không kiểm sản phẩm đó.</p>
      </div>

      <div className="card p-0">
        <ul className="divide-y divide-beige">
          {rows.map((p) => {
            const v = counted[p.id] ?? "";
            const d = v === "" ? 0 : Number(v) - p.qty;
            return (
              <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">{p.label}</span>
                  <span className="block text-xs text-ink/55">{p.brand ?? ""} · trên máy {p.qty} {p.unit}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {v !== "" && d !== 0 && <b className={d > 0 ? "text-[#22612A]" : "text-[#8A2323]"}>{d > 0 ? "+" : ""}{d}</b>}
                  {v !== "" && d === 0 && <span className="text-[#22612A]">✓</span>}
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    className="w-20 rounded-lg border border-beige-dark px-2 py-1.5 text-right"
                    placeholder="đếm"
                    value={v}
                    onChange={(e) => setCounted((x) => ({ ...x, [p.id]: e.target.value }))}
                  />
                </span>
              </li>
            );
          })}
          {rows.length === 0 && <li className="px-4 py-3 text-sm text-ink/60">Không có sản phẩm phù hợp.</li>}
        </ul>
      </div>

      <div className="card sticky bottom-20 space-y-2 p-4 text-sm sm:bottom-2">
        <p>
          Đã đếm <b>{entered.length}</b> sản phẩm · lệch <b className={diffs.length ? "text-[#8A2323]" : ""}>{diffs.length}</b>
        </p>
        {diffs.length > 0 && (
          <input className={`input py-2 ${note.trim() ? "" : "border-[#E0A526]"}`} placeholder="Lý do lệch (bắt buộc): hàng hỏng, vỡ, đếm sai…" value={note} onChange={(e) => setNote(e.target.value)} />
        )}
        {msg && <p className={msg.ok ? "text-[#22612A]" : "text-[#8A2323]"}>{msg.text}</p>}
        <button className="btn-primary w-full" disabled={busy || entered.length === 0 || (diffs.length > 0 && !note.trim())} onClick={submit}>
          {busy ? "Đang lưu…" : "Lưu phiếu kiểm kho"}
        </button>
      </div>
    </div>
  );
}

export function CountReview({ id }: { id: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function review(approve: boolean) {
    setBusy(true);
    setError(null);
    const { error } = await createClient().rpc("review_stock_count", { p_id: id, p_approve: approve, p_note: note });
    setBusy(false);
    if (error) return setError(vnError(error.message));
    router.refresh();
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-beige pt-2 text-xs">
      <input className="min-w-0 flex-1 rounded-lg border border-beige-dark px-2 py-1.5 text-sm" placeholder="Ghi chú (không bắt buộc)" value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="btn-ghost py-1.5 text-[#8A2323]" disabled={busy} onClick={() => review(false)}>Không duyệt</button>
      <button className="btn-primary py-1.5" disabled={busy} onClick={() => review(true)}>Duyệt, cập nhật tồn</button>
      {error && <p className="w-full text-[#8A2323]">{error}</p>}
    </div>
  );
}
