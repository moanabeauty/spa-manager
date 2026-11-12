"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { normalizeText, vnError } from "@/lib/format";
import { OPEN_LEVELS, cleanBarcode, isSingleUse, openLevelLabel } from "@/lib/inventory";
import CameraScanner from "@/components/LazyCameraScanner";

type P = { id: string; label: string; brand: string | null; unit: string; volume?: number | null; barcode: string | null; qty: number };
type Row = { full: string; opened: number[] };

/** Kiểm kho đầu kỳ: chai nguyên (số nguyên) + chai đang dở (mức còn 3/4 · 2/3 · 1/2 · 1/3 · 1/4 · Gần hết) */
export default function OpeningForm({ warehouseId, treatment, products, isOwner }: { warehouseId: string; treatment: boolean; products: P[]; isOwner: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [query, setQuery] = useState("");
  const [onlyEntered, setOnlyEntered] = useState(false);
  const [note, setNote] = useState("");
  const [scan, setScan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const row = (id: string): Row => rows[id] ?? { full: "", opened: [] };
  const setRow = (id: string, f: (r: Row) => Row) => setRows((x) => ({ ...x, [id]: f(x[id] ?? { full: "", opened: [] }) }));

  const entered = Object.entries(rows).filter(([, r]) => r.full !== "" || r.opened.length > 0);
  const missingFull = entered.filter(([, r]) => r.full === "" || !Number.isInteger(Number(r.full)) || Number(r.full) < 0);
  const openedCount = entered.reduce((a, [, r]) => a + r.opened.length, 0);

  const list = useMemo(() => {
    const q = normalizeText(query.trim());
    return products
      .filter((p) => !q || normalizeText(`${p.brand ?? ""} ${p.label} ${p.barcode ?? ""}`).includes(q))
      .filter((p) => !onlyEntered || rows[p.id] !== undefined);
  }, [products, query, onlyEntered, rows]);

  function onScan(raw: string) {
    const c = cleanBarcode(raw);
    const p = products.find((x) => x.barcode === c);
    setScan(false);
    if (!p) return setMsg({ ok: false, text: `Không thấy sản phẩm có mã vạch ${c} trong danh sách.` });
    setQuery(p.label);
    setMsg({ ok: true, text: `Đã tìm: ${p.label} — nhập số chai nguyên và chai dở bên dưới.` });
  }

  async function submit() {
    setBusy(true);
    setMsg(null);
    const { error } = await createClient().rpc("submit_opening_count", {
      p_warehouse_id: warehouseId,
      p_items: entered.map(([product_id, r]) => ({ product_id, counted: Number(r.full), opened: r.opened })),
      p_note: note,
    });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: vnError(error.message) });
    setRows({});
    setNote("");
    setMsg({ ok: true, text: isOwner ? "Đã cập nhật tồn kho đầu kỳ." : "Đã gửi phiếu kiểm đầu kỳ. Tồn kho sẽ cập nhật sau khi chủ spa duyệt." });
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
          <input type="checkbox" checked={onlyEntered} onChange={(e) => setOnlyEntered(e.target.checked)} /> Chỉ hiện sản phẩm đã nhập
        </label>
        <ul className="list-disc space-y-0.5 pl-4 text-xs text-ink/60">
          <li><b>Chai nguyên</b>: đếm chai / lọ / hộp còn nguyên seal (không có thì ghi 0).</li>
          {treatment && <li><b>Chai đang dở</b>: mỗi chai bấm 1 lần vào mức còn ước lượng. Bấm nhầm thì bấm ✕ trên chai đó.</li>}
          {!treatment && <li>Kho bán lẻ chỉ đếm hàng nguyên seal. Hàng đã khui (tester) đếm vào kho liệu trình.</li>}
          <li>Ô bỏ trống = không kiểm sản phẩm đó.</li>
        </ul>
      </div>

      <div className="card p-0">
        <ul className="divide-y divide-beige">
          {list.map((p) => {
            const r = row(p.id);
            const canOpen = treatment && !isSingleUse(p.unit, p.volume);
            return (
              <li key={p.id} className="space-y-2 px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="font-medium">{p.label}</span>
                    <span className="block text-xs text-ink/55">{p.brand ?? ""} · trên máy {p.qty} {p.unit}</span>
                  </span>
                  <label className="flex shrink-0 items-center gap-1 text-xs">
                    Nguyên
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      className={`w-16 rounded-lg border px-2 py-1.5 text-right text-sm ${r.opened.length > 0 && r.full === "" ? "border-[#E0A526]" : "border-beige-dark"}`}
                      placeholder="0"
                      value={r.full}
                      onChange={(e) => setRow(p.id, (x) => ({ ...x, full: e.target.value }))}
                    />
                    {p.unit}
                  </label>
                </div>
                {canOpen && (
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="mr-1 text-xs text-ink/55">+ chai dở:</span>
                      {OPEN_LEVELS.map((l) => (
                        <button
                          key={l.label}
                          type="button"
                          className="rounded-full bg-cream px-2.5 py-1 text-xs font-semibold text-navy ring-1 ring-beige-dark hover:bg-beige"
                          onClick={() => setRow(p.id, (x) => ({ full: x.full === "" ? "0" : x.full, opened: [...x.opened, l.pct] }))}
                        >
                          {l.label}
                        </button>
                      ))}
                    </div>
                    {r.opened.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {r.opened.map((pct, i) => (
                          <span key={i} className="inline-flex items-center gap-1 rounded-full bg-navy px-2.5 py-1 text-xs text-white">
                            🧴 {openLevelLabel(pct)}
                            <button
                              type="button"
                              className="text-white/70 hover:text-white"
                              onClick={() => setRow(p.id, (x) => ({ ...x, opened: x.opened.filter((_, j) => j !== i) }))}
                            >
                              ✕
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
          {list.length === 0 && <li className="px-4 py-3 text-sm text-ink/60">Không có sản phẩm phù hợp.</li>}
        </ul>
      </div>

      <div className="card sticky bottom-20 space-y-2 p-4 text-sm sm:bottom-2">
        <p>
          Đã kiểm <b>{entered.length}</b> sản phẩm{treatment && <> · chai đang dở <b>{openedCount}</b></>}
        </p>
        {missingFull.length > 0 && <p className="text-xs text-[#8A2323]">Còn {missingFull.length} sản phẩm chưa ghi số chai nguyên (không có thì ghi 0).</p>}
        <input className="input py-2" placeholder="Ghi chú (không bắt buộc): ngày chốt, người đếm cùng…" value={note} onChange={(e) => setNote(e.target.value)} />
        {msg && <p className={msg.ok ? "text-[#22612A]" : "text-[#8A2323]"}>{msg.text}</p>}
        <button className="btn-primary w-full" disabled={busy || entered.length === 0 || missingFull.length > 0} onClick={submit}>
          {busy ? "Đang lưu…" : isOwner ? "Lưu & cập nhật tồn đầu kỳ" : "Gửi phiếu kiểm đầu kỳ cho chủ duyệt"}
        </button>
      </div>
    </div>
  );
}
