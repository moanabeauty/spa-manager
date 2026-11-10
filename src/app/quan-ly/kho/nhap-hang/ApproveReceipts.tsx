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
  items: { movement_id: string; product_id: string; quantity: number; expiry_date: string | null }[];
};

/** Chủ spa: nhập giá nhập cho phiếu do kho lập rồi duyệt */
export default function ApproveReceipts({
  receipts,
  products,
  costs,
  debts,
  suppliers,
}: {
  receipts: PendingReceipt[];
  products: Product[];
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
        <ReceiptCard key={r.id} r={r} byId={byId} costs={costs} debts={debts} />
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

function ReceiptCard({
  r,
  byId,
  costs,
  debts,
}: {
  r: PendingReceipt;
  byId: Map<string, Product>;
  costs: Record<string, number | null>;
  debts: Record<string, number>;
}) {
  const router = useRouter();
  const [prices, setPrices] = useState<Record<string, number>>(() =>
    Object.fromEntries(r.items.map((i) => [i.movement_id, Number(costs[i.product_id] ?? 0)])),
  );
  const [extras, setExtras] = useState<Extra[]>(() => r.extra_costs.map((x, k) => ({ key: k, label: x.label, amount: Number(x.amount) })));
  const [supplier, setSupplier] = useState(r.supplier ?? "");
  const [payableEdit, setPayableEdit] = useState<number | null>(null); // null = theo tiền hàng
  const [paid, setPaid] = useState(0);
  const [method, setMethod] = useState("bank_transfer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goods = r.items.reduce((a, i) => a + i.quantity * (prices[i.movement_id] || 0), 0);
  const units = r.items.reduce((a, i) => a + i.quantity, 0);
  const extraTotal = extras.reduce((a, x) => a + (x.amount || 0), 0);
  const landed = (price: number) =>
    extraTotal <= 0 ? price : Math.round(price + (goods > 0 ? (extraTotal * price) / goods : extraTotal / Math.max(1, units)));
  const missing = r.items.some((i) => !(prices[i.movement_id] > 0));
  const payable = payableEdit ?? goods;
  const owe = Math.max(0, payable - paid);
  const debtBefore = debts[supplier.trim().toLowerCase()] ?? 0;

  async function approve() {
    if (paid > payable) return setError("Số đã trả không được lớn hơn số cần trả nhà cung cấp.");
    if (owe > 0 && !supplier.trim()) return setError("Còn nợ → vui lòng ghi tên nhà cung cấp để theo dõi công nợ.");
    if (missing && !window.confirm("Có sản phẩm giá nhập = 0 (hàng tặng?). Vẫn duyệt phiếu?")) return;
    setBusy(true);
    setError(null);
    const { error } = await createClient().rpc("approve_stock_receipt", {
      p_receipt_id: r.id,
      p_prices: r.items.map((i) => ({ movement_id: i.movement_id, unit_cost: prices[i.movement_id] || 0 })),
      p_extra_costs: extras.filter((x) => x.amount > 0).map((x) => ({ label: x.label, amount: x.amount })),
      p_supplier: supplier.trim() || null,
      p_payable: payable,
      p_paid: paid,
      p_method: method,
    });
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

      {r.items.map((i) => {
        const p = byId.get(i.product_id);
        const price = prices[i.movement_id] || 0;
        return (
          <div key={i.movement_id} className="rounded-xl border border-beige-dark p-3">
            <p className="font-medium">{p ? productLabel(p) : "Sản phẩm"}</p>
            <p className="text-xs text-ink/55">
              {[p?.brand, i.expiry_date ? `HSD ${new Date(i.expiry_date).toLocaleDateString("vi-VN")}` : "chưa ghi HSD"].filter(Boolean).join(" · ")}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
              <span className="font-semibold">
                {i.quantity} {p?.unit ?? ""}
              </span>
              <label className="flex items-center gap-1">
                × Giá nhập
                <MoneyInput
                  value={price}
                  onChange={(n) => setPrices((x) => ({ ...x, [i.movement_id]: n }))}
                  className="w-28"
                  ariaLabel="Giá nhập"
                />
              </label>
              {price > 0 && <span className="ml-auto text-ink/60">= {formatVnd(price * i.quantity)}</span>}
            </div>
            {extraTotal > 0 && price > 0 && (
              <p className="mt-1 text-right text-xs text-brown">Giá vốn sau phân bổ chi phí: {formatVnd(landed(price))}</p>
            )}
          </div>
        );
      })}

      <div className="space-y-2 rounded-xl bg-cream p-3">
        <p className="font-semibold text-navy">Chi phí</p>
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

      <dl className="space-y-1 border-t border-beige pt-3">
        <div className="flex justify-between"><dt className="text-ink/65">Tiền hàng</dt><dd>{formatVnd(goods)}</dd></div>
        <div className="flex justify-between"><dt className="text-ink/65">Chi phí</dt><dd>{formatVnd(extraTotal)}</dd></div>
        <div className="flex justify-between font-semibold text-navy"><dt>Tổng đơn</dt><dd>{formatVnd(goods + extraTotal)}</dd></div>
      </dl>

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
        <label className="flex items-center justify-between gap-2">
          <span>Cần trả nhà cung cấp</span>
          <MoneyInput value={payable} onChange={(n) => setPayableEdit(n)} className="w-32" ariaLabel="Cần trả nhà cung cấp" />
        </label>
        <p className="-mt-1 text-xs text-ink/55">Mặc định = tiền hàng. Sửa nếu NCC tính thêm ship / chiết khấu.</p>
        <label className="flex items-center justify-between gap-2">
          <span>Đã trả nhà cung cấp</span>
          <MoneyInput value={paid} onChange={setPaid} className="w-32" ariaLabel="Đã trả" />
        </label>
        {paid > 0 && (
          <select className="w-full rounded-lg border border-beige-dark bg-white px-3 py-2 text-sm" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="bank_transfer">Chuyển khoản</option>
            <option value="cash">Tiền mặt</option>
            <option value="other">Khác</option>
          </select>
        )}
        <div className="flex gap-2 text-xs">
          <button className="rounded-full bg-white px-3 py-1.5 font-semibold text-navy" onClick={() => setPaid(payable)}>Trả đủ</button>
          <button className="rounded-full bg-white px-3 py-1.5 font-semibold text-navy" onClick={() => setPaid(0)}>Chưa trả</button>
        </div>
        <dl className="space-y-1 border-t border-beige-dark pt-2">
          <div className="flex justify-between"><dt className="text-ink/65">Còn nợ phiếu này</dt><dd className={owe > 0 ? "font-semibold text-[#8A2323]" : ""}>{formatVnd(owe)}</dd></div>
          {supplier.trim() && (
            <div className="flex justify-between font-semibold text-navy">
              <dt>Tổng dư nợ với {supplier.trim()}</dt>
              <dd>{formatVnd(debtBefore + owe)}</dd>
            </div>
          )}
        </dl>
      </div>
      {extraTotal > 0 && <p className="text-xs text-ink/55">Chi phí được cộng vào giá vốn từng sản phẩm theo tỷ lệ giá trị hàng.</p>}
      {error && <p className="text-[#8A2323]">{error}</p>}
      <button className="btn-primary w-full py-3" disabled={busy} onClick={approve}>
        {busy ? "Đang duyệt…" : "Duyệt phiếu nhập"}
      </button>
    </div>
  );
}
