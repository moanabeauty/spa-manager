"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { normalizeText, vnError } from "@/lib/format";
import { cleanBarcode } from "@/lib/inventory";
import CameraScanner from "@/components/CameraScanner";

type P = { id: string; label: string; brand: string | null; unit: string; barcode: string | null; qty: number };

export default function TransferForm({ fromId, toId, fromName, toName, products }: {
  fromId: string; toId: string; fromName: string; toName: string; products: P[];
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("");
  const [scan, setScan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const found = useMemo(() => {
    const q = normalizeText(query.trim());
    if (!q) return [];
    return products.filter((p) => normalizeText(`${p.brand ?? ""} ${p.label} ${p.barcode ?? ""}`).includes(q)).slice(0, 8);
  }, [products, query]);
  const lines = Object.entries(picked).filter(([, n]) => n > 0);
  const over = lines.some(([id, n]) => n > (byId.get(id)?.qty ?? 0));

  function add(p: P) {
    setPicked((x) => ({ ...x, [p.id]: Math.min(p.qty, (x[p.id] ?? 0) + 1) }));
    setQuery("");
  }
  async function submit() {
    setBusy(true);
    setMsg(null);
    const { error } = await createClient().rpc("transfer_stock", {
      p_from: fromId, p_to: toId, p_items: lines.map(([product_id, quantity]) => ({ product_id, quantity })), p_note: note,
    });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: vnError(error.message) });
    setPicked({});
    setNote("");
    setMsg({ ok: true, text: `Đã chuyển ${lines.length} sản phẩm sang ${toName}.` });
    router.refresh();
  }

  return (
    <div className="card space-y-3 p-4 text-sm">
      <p className="font-semibold text-navy">{fromName} → {toName}</p>
      <div className="flex gap-2">
        <input className="input min-w-0 flex-1 py-2" placeholder="Tìm sản phẩm còn trong kho chuyển…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="btn-outline shrink-0 py-2" onClick={() => setScan(!scan)}>📷 Quét</button>
      </div>
      {scan && (
        <CameraScanner
          onScan={(raw) => {
            const p = products.find((x) => x.barcode === cleanBarcode(raw));
            setScan(false);
            if (p) add(p);
            else setMsg({ ok: false, text: "Sản phẩm này không còn trong kho chuyển." });
          }}
          onClose={() => setScan(false)}
        />
      )}
      {found.length > 0 && (
        <ul className="divide-y divide-beige rounded-xl border border-beige-dark">
          {found.map((p) => (
            <li key={p.id}>
              <button className="flex w-full justify-between gap-2 px-3 py-2 text-left hover:bg-cream" onClick={() => add(p)}>
                <span>{p.label}</span>
                <span className="shrink-0 text-xs text-ink/60">còn {p.qty} {p.unit}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {lines.length === 0 ? (
        <p className="text-xs text-ink/60">Chưa chọn sản phẩm nào. Kho chuyển đang có {products.length} sản phẩm còn hàng.</p>
      ) : (
        <ul className="space-y-1">
          {lines.map(([id, n]) => {
            const p = byId.get(id)!;
            return (
              <li key={id} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">{p.label}</span>
                <span className="flex shrink-0 items-center gap-1">
                  <input type="number" min={1} max={p.qty} className={`w-16 rounded-lg border px-2 py-1 text-right ${n > p.qty ? "border-[#8A2323]" : "border-beige-dark"}`}
                    value={n} onChange={(e) => setPicked((x) => ({ ...x, [id]: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))} />
                  <span className="w-16 text-xs text-ink/60">/ {p.qty} {p.unit}</span>
                  <button className="text-ink/40 hover:text-[#8A2323]" onClick={() => setPicked((x) => { const y = { ...x }; delete y[id]; return y; })}>✕</button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <input className="input py-2" placeholder="Ghi chú (không bắt buộc)" value={note} onChange={(e) => setNote(e.target.value)} />
      {msg && <p className={msg.ok ? "text-[#22612A]" : "text-[#8A2323]"}>{msg.text}</p>}
      <button className="btn-primary w-full" disabled={busy || lines.length === 0 || over} onClick={submit}>
        {busy ? "Đang chuyển…" : over ? "Số lượng vượt tồn kho" : `Chuyển ${lines.length} sản phẩm`}
      </button>
    </div>
  );
}
