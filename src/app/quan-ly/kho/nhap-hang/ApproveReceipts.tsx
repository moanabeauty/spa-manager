"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatTime, formatVnd, vnError } from "@/lib/format";
import { productLabel, type Product } from "@/lib/inventory";
import MoneyInput from "@/components/MoneyInput";

export type PendingReceipt = {
  id: string;
  code: string;
  supplier: string | null;
  note: string | null;
  created_at: string;
  warehouse: string;
  creator: string;
  extra_costs: { label: string; amount: number }[];
  items: { item_id: string; product_id: string; quantity: number; expiry_date: string | null }[];
};

/** Chủ spa: nhập giá niêm yết NCC / chiết khấu / giá nhập cho phiếu do kho lập, sửa phiếu rồi duyệt hoặc không duyệt */
export default function ApproveReceipts({
  receipts,
  products,
  listPrices,
  costs,
  debts,
  suppliers,
}: {
  receipts: PendingReceipt[];
  products: Product[];
  listPrices: Record<string, number>;
  costs: Record<string, number | null>;
  debts: Record<string, number>;
  suppliers: string[];
}) {
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  if (receipts.length === 0) return null;
  return (
    <div className="space-y-3">
      <h2 className="font-semibold text-navy">Phiếu nhập chờ duyệt giá ({receipts.length})</h2>
      {receipts.map((r) => (
        <ReceiptCard key={r.id} r={r} products={products} byId={byId} listPrices={listPrices} costs={costs} debts={debts} />
      ))}
      <datalist id="ncc-list-owner">
        {suppliers.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
    </div>
  );
}

type Extra = { key: number; label: string; amount: number };
type Line = {
  key: string;
  item_id: string | null;
  product_id: string;
  quantity: number;
  expiry_date: string | null;
  list: number; // 0 = chưa có giá niêm yết
  pct: number | null;
  price: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const priceFrom = (list: number, pct: number) => Math.round((list * (100 - pct)) / 100);
const pctFrom = (list: number, price: number) => (list > 0 && price > 0 ? Math.max(0, round2((1 - price / list) * 100)) : null);

function ReceiptCard({
  r,
  products,
  byId,
  listPrices,
  costs,
  debts,
}: {
  r: PendingReceipt;
  products: Product[];
  byId: Map<string, Product>;
  listPrices: Record<string, number>;
  costs: Record<string, number | null>;
  debts: Record<string, number>;
}) {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>(() =>
    r.items.map((i) => ({
      key: i.item_id,
      item_id: i.item_id,
      product_id: i.product_id,
      quantity: i.quantity,
      expiry_date: i.expiry_date,
      list: Number(listPrices[i.product_id] ?? 0),
      pct: null,
      price: 0,
    })),
  );
  const [globalPct, setGlobalPct] = useState<string>("");
  const [extras, setExtras] = useState<Extra[]>(() => r.extra_costs.map((x, k) => ({ key: k, label: x.label, amount: Number(x.amount) })));
  const [supplier, setSupplier] = useState(r.supplier ?? "");
  const [paid, setPaid] = useState(0);
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goods = lines.reduce((a, l) => a + l.quantity * (l.price || 0), 0);
  const extraTotal = extras.reduce((a, x) => a + (x.amount || 0), 0);
  const payable = goods; // chỉ tiền hàng; ship / chi phí khác trả ngoài
  const owe = Math.max(0, payable - paid);
  const debtBefore = debts[supplier.trim().toLowerCase()] ?? 0;

  const update = (key: string, f: (l: Line) => Line) => setLines((ls) => ls.map((l) => (l.key === key ? f(l) : l)));
  const setList = (key: string, list: number) =>
    update(key, (l) => {
      if (list > 0 && l.pct != null) return { ...l, list, price: priceFrom(list, l.pct) };
      return { ...l, list, pct: pctFrom(list, l.price) };
    });
  const setPct = (key: string, pct: number | null) =>
    update(key, (l) => (pct != null && l.list > 0 ? { ...l, pct, price: priceFrom(l.list, pct) } : { ...l, pct }));
  const setPrice = (key: string, price: number) => update(key, (l) => ({ ...l, price, pct: pctFrom(l.list, price) }));

  function applyGlobal() {
    const pct = Number(globalPct.replace(",", "."));
    if (!globalPct.trim() || Number.isNaN(pct) || pct < 0 || pct > 100) return setError("Chiết khấu chung phải từ 0 đến 100%.");
    setError(null);
    setLines((ls) => ls.map((l) => (l.list > 0 ? { ...l, pct, price: priceFrom(l.list, pct) } : l)));
  }

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter((p) => [p.name, p.brand, p.sku, p.barcode, p.capacity].filter(Boolean).join(" ").toLowerCase().includes(q))
      .slice(0, 8);
  }, [search, products]);

  function addProduct(p: Product) {
    setLines((ls) => [
      ...ls,
      { key: `new-${Date.now()}`, item_id: null, product_id: p.id, quantity: 1, expiry_date: null, list: Number(listPrices[p.id] ?? 0), pct: null, price: 0 },
    ]);
    setSearch("");
    setAdding(false);
  }

  async function approve() {
    if (lines.length === 0) return setError("Phiếu không còn sản phẩm nào. Nếu không nhập hàng, bấm “Không duyệt”.");
    if (lines.some((l) => !(l.quantity > 0))) return setError("Số lượng phải lớn hơn 0.");
    if (paid > payable) return setError("Số đã trả không được lớn hơn số cần trả nhà cung cấp.");
    if (owe > 0 && !supplier.trim()) return setError("Còn nợ → vui lòng ghi tên nhà cung cấp để theo dõi công nợ.");
    if (lines.some((l) => !(l.price > 0)) && !window.confirm("Có sản phẩm giá nhập = 0 (hàng tặng?). Vẫn duyệt phiếu?")) return;
    setBusy(true);
    setError(null);
    const gp = Number(globalPct.replace(",", "."));
    const { error } = await createClient().rpc("approve_stock_receipt_v2", {
      p_receipt_id: r.id,
      p_items: lines.map((l) => ({
        item_id: l.item_id,
        product_id: l.product_id,
        quantity: l.quantity,
        expiry_date: l.expiry_date,
        list_price: l.list > 0 ? l.list : null,
        discount_pct: l.pct,
        unit_cost: l.price || 0,
      })),
      p_extra_costs: extras.filter((x) => x.amount > 0).map((x) => ({ label: x.label, amount: x.amount })),
      p_supplier: supplier.trim() || null,
      p_paid: paid,
      p_discount_pct: globalPct.trim() && !Number.isNaN(gp) ? gp : null,
    });
    setBusy(false);
    if (error) return setError(vnError(error.message));
    router.refresh();
  }

  async function reject() {
    const reason = window.prompt(`Không duyệt phiếu ${r.code}? Hàng của phiếu sẽ bị trừ khỏi kho.\nLý do (có thể bỏ trống):`, "");
    if (reason === null) return;
    setBusy(true);
    setError(null);
    const { error } = await createClient().rpc("reject_stock_receipt", { p_receipt_id: r.id, p_reason: reason });
    setBusy(false);
    if (error) return setError(vnError(error.message));
    router.refresh();
  }

  return (
    <div className="card space-y-3 border-2 border-[#E0A526] p-4 text-sm">
      <div>
        <p className="font-semibold text-navy">
          {r.code} · {r.warehouse}
        </p>
        <p className="text-xs text-ink/60">
          {formatTime(r.created_at)} {new Date(r.created_at).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })} · {r.creator}
          {r.supplier ? ` · NCC: ${r.supplier}` : ""}
        </p>
        {r.note && <p className="mt-1 text-xs italic text-ink/70">“{r.note}”</p>}
      </div>

      {/* chiết khấu chung */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-cream p-3">
        <span className="font-semibold text-navy">Chiết khấu chung cả phiếu</span>
        <input
          inputMode="decimal"
          className="w-16 rounded-lg border border-beige-dark bg-white px-2 py-1.5 text-right"
          placeholder="0"
          value={globalPct}
          onChange={(e) => setGlobalPct(e.target.value)}
          aria-label="Chiết khấu chung %"
        />
        <span>%</span>
        <button className="rounded-full bg-navy px-3 py-1.5 text-xs font-semibold text-white" onClick={applyGlobal}>
          Áp cho tất cả
        </button>
        <p className="w-full text-xs text-ink/55">Áp cho các dòng có giá niêm yết. Sau đó vẫn sửa riêng từng dòng được.</p>
      </div>

      {lines.map((l) => {
        const p = byId.get(l.product_id);
        const last = costs[l.product_id];
        return (
          <div key={l.key} className="space-y-2 rounded-xl border border-beige-dark p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {p ? productLabel(p) : "Sản phẩm"}
                  {!l.item_id && <span className="ml-1 rounded-full bg-[#D6EDD8] px-2 py-0.5 text-[11px] text-[#22612A]">chủ thêm</span>}
                </p>
                <p className="text-xs text-ink/55">
                  {[p?.brand, l.expiry_date ? `HSD ${new Date(l.expiry_date).toLocaleDateString("vi-VN")}` : "chưa ghi HSD", last ? `giá vốn lần trước ${formatVnd(Number(last))}` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <button
                className="px-1 text-ink/40 hover:text-[#8A2323]"
                onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                aria-label="Xoá dòng"
                title="Xoá dòng"
              >
                ✕
              </button>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs sm:grid-cols-4">
              <label className="space-y-1">
                <span className="block text-ink/60">Số lượng ({p?.unit ?? ""})</span>
                <input
                  inputMode="numeric"
                  className="w-full rounded-lg border border-beige-dark bg-white px-2 py-1.5 text-right text-sm"
                  value={l.quantity || ""}
                  onChange={(e) => update(l.key, (x) => ({ ...x, quantity: Math.max(0, parseInt(e.target.value.replace(/\D/g, "") || "0", 10)) }))}
                />
              </label>
              <label className="space-y-1">
                <span className="block text-ink/60">Giá niêm yết NCC</span>
                <MoneyInput value={l.list} onChange={(n) => setList(l.key, n)} className="w-full" placeholder="trống" ariaLabel="Giá niêm yết NCC" />
              </label>
              <label className="space-y-1">
                <span className="block text-ink/60">Chiết khấu %</span>
                <input
                  inputMode="decimal"
                  disabled={!(l.list > 0)}
                  className="w-full rounded-lg border border-beige-dark bg-white px-2 py-1.5 text-right text-sm disabled:bg-cream disabled:text-ink/40"
                  placeholder={l.list > 0 ? "0" : "—"}
                  value={l.pct ?? ""}
                  onChange={(e) => {
                    const v = e.target.value.replace(",", ".");
                    if (v.trim() === "") return setPct(l.key, null);
                    const n = Number(v);
                    if (!Number.isNaN(n) && n >= 0 && n <= 100) setPct(l.key, n);
                  }}
                  aria-label="Chiết khấu %"
                />
              </label>
              <label className="space-y-1">
                <span className="block text-ink/60">Giá nhập</span>
                <MoneyInput value={l.price} onChange={(n) => setPrice(l.key, n)} className="w-full" ariaLabel="Giá nhập" />
              </label>
            </div>
            <p className="text-right text-xs">
              Thành tiền: <b className="text-navy">{formatVnd(l.quantity * (l.price || 0))}</b>
            </p>
          </div>
        );
      })}

      {/* chủ thêm sản phẩm */}
      {adding ? (
        <div className="space-y-2 rounded-xl border border-dashed border-navy/40 p-3">
          <input
            autoFocus
            className="w-full rounded-lg border border-beige-dark bg-white px-3 py-2 text-sm"
            placeholder="Tìm tên, nhãn hàng, mã SP, mã vạch…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {matches.map((p) => (
            <button key={p.id} className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-cream" onClick={() => addProduct(p)}>
              {productLabel(p)} <span className="text-xs text-ink/55">{p.brand}</span>
            </button>
          ))}
          <button className="text-xs text-ink/60 underline" onClick={() => setAdding(false)}>
            Đóng
          </button>
        </div>
      ) : (
        <button className="rounded-full border border-navy/30 bg-white px-3 py-1.5 text-xs font-semibold text-navy" onClick={() => setAdding(true)}>
          + Thêm sản phẩm
        </button>
      )}

      <div className="space-y-2 rounded-xl bg-cream p-3">
        <p className="font-semibold text-navy">Chi phí (trả riêng, không tính vào nợ NCC)</p>
        {extras.length === 0 && <p className="text-xs text-ink/55">Kho không ghi chi phí nào.</p>}
        {extras.map((x) => (
          <div key={x.key} className="flex items-center gap-2">
            <input
              className="min-w-0 flex-1 rounded-lg border border-beige-dark bg-white px-3 py-2 text-sm"
              value={x.label}
              onChange={(e) => setExtras((xs) => xs.map((y) => (y.key === x.key ? { ...y, label: e.target.value } : y)))}
            />
            <MoneyInput
              value={x.amount}
              onChange={(n) => setExtras((xs) => xs.map((y) => (y.key === x.key ? { ...y, amount: n } : y)))}
              className="w-28"
              ariaLabel="Số tiền"
            />
            <button className="px-1 text-ink/40 hover:text-[#8A2323]" onClick={() => setExtras((xs) => xs.filter((y) => y.key !== x.key))} aria-label="Xoá">
              ✕
            </button>
          </div>
        ))}
        <div className="flex gap-2">
          {["Tiền ship", "Chi phí khác"].map((label) => (
            <button
              key={label}
              className="rounded-full border border-navy/30 bg-white px-3 py-1.5 text-xs font-semibold text-navy"
              onClick={() => setExtras((xs) => [...xs, { key: Date.now(), label, amount: 0 }])}
            >
              + {label}
            </button>
          ))}
        </div>
      </div>

      {/* công nợ nhà cung cấp */}
      <div className="space-y-2 rounded-xl bg-cream p-3">
        <p className="font-semibold text-navy">Thanh toán nhà cung cấp</p>
        <input
          className="w-full rounded-lg border border-beige-dark bg-white px-3 py-2 text-sm"
          placeholder="Tên nhà cung cấp"
          list="ncc-list-owner"
          value={supplier}
          onChange={(e) => setSupplier(e.target.value)}
        />
        <div className="flex items-center justify-between gap-2">
          <span>Tổng tiền hàng phải trả NCC</span>
          <b>{formatVnd(payable)}</b>
        </div>
        <label className="flex items-center justify-between gap-2">
          <span>Đã trả nhà cung cấp</span>
          <MoneyInput value={paid} onChange={setPaid} className="w-32" ariaLabel="Đã trả" />
        </label>
        <div className="flex gap-2 text-xs">
          <button className="rounded-full bg-white px-3 py-1.5 font-semibold text-navy" onClick={() => setPaid(payable)}>Trả đủ</button>
          <button className="rounded-full bg-white px-3 py-1.5 font-semibold text-navy" onClick={() => setPaid(0)}>Chưa trả</button>
        </div>
        <dl className="space-y-1 border-t border-beige-dark pt-2">
          <div className="flex justify-between"><dt className="text-ink/65">Còn nợ phiếu này</dt><dd className={owe > 0 ? "font-semibold text-[#8A2323]" : ""}>{formatVnd(owe)}</dd></div>
          {supplier.trim() && (
            <div className="flex justify-between font-semibold text-navy">
              <dt>Tổng nợ với {supplier.trim()}</dt>
              <dd>{formatVnd(debtBefore + owe)}</dd>
            </div>
          )}
          {extraTotal > 0 && (
            <div className="flex justify-between text-ink/65"><dt>Ship / chi phí khác (trả riêng)</dt><dd>{formatVnd(extraTotal)}</dd></div>
          )}
        </dl>
      </div>
      {extraTotal > 0 && <p className="text-xs text-ink/55">Chi phí được cộng vào giá vốn từng sản phẩm theo tỷ lệ giá trị hàng.</p>}
      {error && <p className="text-[#8A2323]">{error}</p>}
      <div className="flex gap-2">
        <button className="flex-1 rounded-xl border border-[#8A2323]/40 bg-white py-3 font-semibold text-[#8A2323]" disabled={busy} onClick={reject}>
          Không duyệt
        </button>
        <button className="btn-primary flex-[2] py-3" disabled={busy} onClick={approve}>
          {busy ? "Đang xử lý…" : "Duyệt phiếu nhập"}
        </button>
      </div>
    </div>
  );
}
