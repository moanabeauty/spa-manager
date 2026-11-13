"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { normalizeText, vnError } from "@/lib/format";
import { OPEN_LEVELS, cleanBarcode, isSingleUse, parseDec } from "@/lib/inventory";
import CameraScanner from "@/components/LazyCameraScanner";
import { initPack } from "@/components/PackQty";
import PackCell, { cellTotal, cellUsed, savePackChanges, type Cell, type CountP } from "./PackCell";

type Row = { cell?: Cell; opened: number[] };

/** Kiểm kho đầu kỳ: hàng nguyên (theo hộp hoặc theo ống) + ống / chai đang dở (bấm mức 3/4 · 1/2… hoặc gõ số thập phân / số ml) */
export default function OpeningForm({ warehouseId, treatment, products, isOwner }: { warehouseId: string; treatment: boolean; products: CountP[]; isOwner: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [query, setQuery] = useState("");
  const [onlyEntered, setOnlyEntered] = useState(false);
  const [note, setNote] = useState("");
  const [scan, setScan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const row = (id: string): Row => rows[id] ?? { opened: [] };
  const setRow = (id: string, f: (r: Row) => Row) =>
    setRows((x) => {
      const r = f(x[id] ?? { opened: [] });
      const n = { ...x };
      if (!r.cell && r.opened.length === 0) delete n[id];
      else n[id] = r;
      return n;
    });

  const entered = Object.entries(rows).filter(([, r]) => cellUsed(r.cell) || r.opened.length > 0);
  const missingFull = entered.filter(([, r]) => !cellUsed(r.cell) || cellTotal(r.cell) === null);
  const openedCount = entered.reduce((a, [, r]) => a + r.opened.length, 0);
  const cells = Object.fromEntries(Object.entries(rows).filter(([, r]) => r.cell).map(([id, r]) => [id, r.cell as Cell]));

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
    setMsg({ ok: true, text: `Đã tìm: ${p.label} — nhập số nguyên và ống / chai dở bên dưới.` });
  }

  async function submit() {
    setBusy(true);
    setMsg(null);
    const perr = await savePackChanges(products, cells);
    if (perr) {
      setBusy(false);
      return setMsg({ ok: false, text: perr });
    }
    const { error } = await createClient().rpc("submit_opening_count", {
      p_warehouse_id: warehouseId,
      p_items: entered.map(([product_id, r]) => ({ product_id, counted: cellTotal(r.cell), opened: r.opened })),
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
          <li><b>Nguyên</b>: đếm ống / lọ / chai còn nguyên seal (không có thì ghi 0). Bấm <b>Hộp/ống</b> để đếm theo hộp (số hộp × số ống/hộp + ống lẻ) hoặc sửa số ml mỗi ống.</li>
          {treatment && <li><b>Đang dở</b>: mỗi ống / chai bấm 1 lần vào mức còn, hoặc gõ số thập phân (0,33 = còn 1/3 ống) hay số ml rồi bấm Thêm. Nhầm thì bấm ✕.</li>}
          {!treatment && <li>Kho bán lẻ chỉ đếm hàng nguyên seal. Hàng đã khui (tester) đếm vào kho liệu trình.</li>}
          <li>Ô bỏ trống = không kiểm sản phẩm đó.</li>
        </ul>
      </div>

      <div className="card p-0">
        <ul className="divide-y divide-beige">
          {list.map((p) => {
            const r = row(p.id);
            const vol = (r.cell && r.cell.open ? parseDec(r.cell.pe.volume) : null) ?? (p.volume != null ? Number(p.volume) : null);
            const unit = r.cell?.pe.unit && r.cell.pe.unit !== "hộp" ? r.cell.pe.unit : p.unit;
            const canOpen = treatment && !isSingleUse(unit, vol);
            const addOpened = (pct: number) =>
              setRow(p.id, (x) => ({ cell: x.cell ?? { pe: { ...initPack(p), mode: "unit", loose: "0" }, open: false }, opened: [...x.opened, Math.round(pct * 100) / 100] }));
            return (
              <li key={p.id} className="space-y-2 px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="font-medium">{p.label}</span>
                    <span className="block text-xs text-ink/55">{p.brand ?? ""} · trên máy {p.qty} {p.unit}</span>
                  </span>
                  {!r.cell?.open && <PackCell p={p} cell={r.cell} onChange={(c) => setRow(p.id, (x) => ({ ...x, cell: c }))} />}
                </div>
                {r.cell?.open && <PackCell p={p} cell={r.cell} onChange={(c) => setRow(p.id, (x) => ({ ...x, cell: c }))} />}
                {canOpen && (
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="mr-1 text-xs text-ink/55">+ {unit} dở:</span>
                      {OPEN_LEVELS.map((l) => (
                        <button
                          key={l.label}
                          type="button"
                          className="rounded-full bg-cream px-2.5 py-1 text-xs font-semibold text-navy ring-1 ring-beige-dark hover:bg-beige"
                          onClick={() => addOpened(l.pct)}
                        >
                          {l.label}
                        </button>
                      ))}
                    </div>
                    <DecimalOpened unit={unit} volume={vol} onAdd={addOpened} />
                    {r.opened.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {r.opened.map((pct, i) => (
                          <span key={i} className="inline-flex items-center gap-1 rounded-full bg-navy px-2.5 py-1 text-xs text-white">
                            🧴 {openedLabel(pct, unit, vol)}
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
          Đã kiểm <b>{entered.length}</b> sản phẩm{treatment && <> · ống / chai đang dở <b>{openedCount}</b></>}
        </p>
        {missingFull.length > 0 && <p className="text-xs text-[#8A2323]">Còn {missingFull.length} sản phẩm chưa ghi đủ số nguyên (không có thì ghi 0; theo hộp cần số ống/hộp).</p>}
        <input className="input py-2" placeholder="Ghi chú (không bắt buộc): ngày chốt, người đếm cùng…" value={note} onChange={(e) => setNote(e.target.value)} />
        {msg && <p className={msg.ok ? "text-[#22612A]" : "text-[#8A2323]"}>{msg.text}</p>}
        <button className="btn-primary w-full" disabled={busy || entered.length === 0 || missingFull.length > 0} onClick={submit}>
          {busy ? "Đang lưu…" : isOwner ? "Lưu & cập nhật tồn đầu kỳ" : "Gửi phiếu kiểm đầu kỳ cho chủ duyệt"}
        </button>
      </div>
    </div>
  );
}

const fmt = (n: number) => n.toLocaleString("vi-VN", { maximumFractionDigits: 2 });

/** 33.33 → "1/3 · 0,83ml"; 42 → "0,42 ống · 1,05ml" */
function openedLabel(pct: number, unit: string, vol: number | null): string {
  const lv = OPEN_LEVELS.find((l) => Math.abs(l.pct - pct) < 0.01);
  const head = lv ? lv.label : `${fmt(pct / 100)} ${unit}`;
  return vol && vol > 1 ? `${head} · ${fmt((vol * pct) / 100)}ml` : head;
}

/** Gõ tay phần còn lại: số thập phân (0,33 ống) hoặc số ml */
function DecimalOpened({ unit, volume, onAdd }: { unit: string; volume: number | null; onAdd: (pct: number) => void }) {
  const [text, setText] = useState("");
  const [by, setBy] = useState<"part" | "ml">("part");
  const [err, setErr] = useState<string | null>(null);
  const canMl = volume != null && volume > 1;
  function add() {
    const n = parseDec(text);
    if (n === null || n <= 0) return setErr("Gõ số lớn hơn 0");
    const pct = by === "ml" ? (n / (volume as number)) * 100 : n * 100;
    if (pct > 100) return setErr(by === "ml" ? `Tối đa ${fmt(volume as number)}ml (1 ${unit})` : `Phần còn lại tối đa là 1 ${unit}`);
    onAdd(pct);
    setText("");
    setErr(null);
  }
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs">
      <span className="text-ink/55">hoặc gõ:</span>
      <input
        inputMode="decimal"
        className="w-16 rounded-lg border border-beige-dark bg-white px-2 py-1 text-right text-sm"
        placeholder={by === "ml" ? "ml" : "0,5"}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && add()}
        aria-label="Phần còn lại"
      />
      <select className="rounded-lg border border-beige-dark bg-white px-1.5 py-1 text-xs" value={by} onChange={(e) => setBy(e.target.value as "part" | "ml")}>
        <option value="part">{unit} (0–1)</option>
        {canMl && <option value="ml">ml</option>}
      </select>
      <button type="button" className="rounded-full bg-navy px-3 py-1 font-semibold text-white" onClick={add}>
        Thêm
      </button>
      {err && <span className="text-[#8A2323]">{err}</span>}
    </div>
  );
}
