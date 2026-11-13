"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatTime, formatVnd, normalizeText, vnError } from "@/lib/format";
import {
  PRODUCT_COLUMNS,
  UNITS,
  WAREHOUSE_LABEL,
  cleanBarcode,
  productLabel,
  volumeUnit,
  type Product,
  type Warehouse,
  type WarehouseType,
} from "@/lib/inventory";
import MoneyInput from "@/components/MoneyInput";
import CameraScanner from "@/components/LazyCameraScanner";
import PackQty, { initPack, packChange, packError, packTotal, type PackEntry } from "@/components/PackQty";

export type RecentReceipt = {
  id: string;
  code: string;
  supplier: string | null;
  note: string | null;
  created_at: string;
  approved_at: string | null;
  rejected_at: string | null;
  reject_reason: string | null;
  status: "pending" | "approved" | "rejected";
  warehouses: { name: string } | null;
  profiles: { full_name: string | null } | null;
  stock_receipt_items: { id: string; product_id: string; quantity: number; expiry_date: string | null; pack_size?: number | null }[];
  extra_costs?: { label: string; amount: number }[];
};

const vnDate = (iso: string) => new Date(iso).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
const vnDay = (d: string) => d.split("-").reverse().join("/");

type Line = { productId: string; exp: string; pe: PackEntry };
type Extra = { key: number; label: string; amount: number };

const EXTRA_PRESETS = ["Tiền ship", "Chi phí khác"];

export default function ReceiveForm({
  branches,
  defaultBranchId,
  defaultType,
  warehouses,
  initialProducts,
  recent,
  recentTitle = "Phiếu nhập gần đây",
  suppliers,
}: {
  branches: { id: string; name: string }[];
  defaultBranchId: string;
  defaultType: WarehouseType | null;
  warehouses: Warehouse[];
  initialProducts: Product[];
  recent: RecentReceipt[];
  recentTitle?: string;
  suppliers: string[];
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const byBarcode = useMemo(() => new Map(products.filter((p) => p.barcode && !p.deleted_at).map((p) => [p.barcode!, p])), [products]);

  const [branchId, setBranchId] = useState(defaultBranchId);
  const [type, setType] = useState<WarehouseType | null>(defaultType);
  const wh = warehouses.find((w) => w.branch_id === branchId && w.type === type);

  const [lines, setLines] = useState<Line[]>([]);
  const [supplier, setSupplier] = useState("");
  const [note, setNote] = useState("");
  const [extras, setExtras] = useState<Extra[]>([]);
  const [code, setCode] = useState("");
  const [unknown, setUnknown] = useState<string | null>(null); // mã vạch chưa có trong danh mục
  const [camera, setCamera] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scanRef.current?.focus();
  }, []);

  function addProduct(p: Product) {
    const inc = (s: string) => String((Number(s) || 0) + 1);
    setLines((ls) => {
      const i = ls.findIndex((l) => l.productId === p.id);
      if (i >= 0)
        return ls.map((l, k) =>
          k === i ? { ...l, pe: l.pe.mode === "box" ? { ...l.pe, boxes: inc(l.pe.boxes) } : { ...l.pe, loose: inc(l.pe.loose) } } : l,
        );
      const pe = initPack(p);
      return [{ productId: p.id, exp: "", pe: pe.mode === "box" ? { ...pe, boxes: "1" } : { ...pe, loose: "1" } }, ...ls];
    });
    setFlash(`+1 ${p.pack_size ? "hộp" : p.unit} ${productLabel(p)}`);
    setDone(null);
  }
  const setPe = (id: string, pe: PackEntry) => setLines((ls) => ls.map((x) => (x.productId === id ? { ...x, pe } : x)));

  function handleCode(raw: string) {
    const c = cleanBarcode(raw);
    if (!c) return;
    const p = byBarcode.get(c);
    if (p) {
      addProduct(p);
      setUnknown(null);
    } else {
      setUnknown(c);
      setCamera(false);
      setFlash(null);
    }
    setCode("");
  }

  const found = useMemo(() => {
    const q = normalizeText(search.trim());
    if (!q) return [];
    return products
      .filter((p) => !p.deleted_at)
      .filter((p) => normalizeText(`${p.brand ?? ""} ${p.name} ${p.capacity ?? ""}`).includes(q))
      .slice(0, 8);
  }, [search, products]);

  const totalQty = lines.reduce((a, l) => a + (packTotal(l.pe, false) ?? 0), 0);
  const extraTotal = extras.reduce((a, x) => a + (x.amount || 0), 0);
  const minExp = useMemo(() => {
    const d = new Date(Date.now() + 7 * 3600 * 1000 + 86400 * 1000); // ngày mai (giờ VN)
    return d.toISOString().slice(0, 10);
  }, []);
  const noExp = lines.filter((l) => !l.exp).length;

  async function save() {
    if (!type) return setError("Hãy tick chọn nhập vào Kho liệu trình hay Kho bán lẻ.");
    if (!wh || lines.length === 0) return;
    for (const l of lines) {
      const p = byId.get(l.productId);
      const err = packError(l.pe, p);
      const n = packTotal(l.pe, false);
      if (err || !n) return setError(`${p ? productLabel(p) : "Sản phẩm"}: ${err ?? "nhập số lượng lớn hơn 0"}`);
    }
    if (noExp > 0 && !window.confirm(`Còn ${noExp} sản phẩm chưa nhập hạn sử dụng. Vẫn lưu phiếu?`)) return;
    setSaving(true);
    setError(null);
    // lưu quy cách mới (đơn vị lẻ, ml / ống, số ống / hộp) vào sản phẩm trước
    const changed: string[] = [];
    for (const l of lines) {
      const p = byId.get(l.productId);
      const ch = p ? packChange(p, l.pe) : null;
      if (!p || !ch) continue;
      const { error } = await supabase.rpc("set_product_pack", { p_id: p.id, ...ch });
      if (error) {
        setSaving(false);
        return setError(`${productLabel(p)}: ${vnError(error.message)}`);
      }
      changed.push(p.id);
    }
    if (changed.length) {
      const { data: fresh } = await supabase.from("products").select(PRODUCT_COLUMNS).in("id", changed);
      const m = new Map(((fresh ?? []) as Product[]).map((x) => [x.id, x]));
      setProducts((ps) => ps.map((x) => m.get(x.id) ?? x));
    }
    const { data, error } = await supabase.rpc("receive_stock", {
      p_warehouse_id: wh.id,
      p_supplier: supplier,
      p_note: note,
      p_items: lines.map((l) => ({
        product_id: l.productId,
        quantity: packTotal(l.pe, false),
        pack_size: l.pe.mode === "box" ? Number(l.pe.pack) : null,
        expiry_date: l.exp || null,
      })),
      p_extra_costs: extras.filter((x) => x.amount > 0).map((x) => ({ label: x.label, amount: x.amount })),
    });
    setSaving(false);
    if (error) return setError(vnError(error.message));
    const { data: r } = await supabase.from("stock_receipts").select("code").eq("id", data as string).maybeSingle();
    setDone(`Đã lưu phiếu nhập ${r?.code ?? ""} (${totalQty} đơn vị, ${wh.name}). Hàng sẽ cộng vào kho khi chủ spa duyệt phiếu.`);
    setLines([]);
    setExtras([]);
    setSupplier("");
    setNote("");
    setFlash(null);
    router.refresh();
    scanRef.current?.focus();
  }

  return (
    <div className="space-y-4 pb-24">
      {/* chi nhánh nhận */}
      {branches.length > 1 && (
        <div className="card p-4">
          <select className="input py-2" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* quét mã */}
      <div className="card space-y-3 p-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            handleCode(code);
          }}
        >
          <input
            ref={scanRef}
            className="input flex-1 py-2 font-mono"
            placeholder="Quét / gõ mã vạch rồi Enter"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
            enterKeyHint="done"
          />
          <button type="submit" className="btn-outline px-4 py-2" disabled={!code.trim()}>Thêm</button>
          <button type="button" className="btn-primary px-4 py-2" onClick={() => setCamera(true)} title="Quét bằng camera">
            📷
          </button>
        </form>
        {flash && <p className="rounded-lg bg-[#D6EDD8] px-3 py-1.5 text-sm text-[#22612A]">✓ {flash}</p>}

        {unknown && (
          <UnknownBarcode
            barcode={unknown}
            warehouseType={type}
            products={products}
            onLinked={(p) => {
              setProducts((ps) => {
                const exists = ps.some((x) => x.id === p.id);
                return exists ? ps.map((x) => (x.id === p.id ? p : x)) : [...ps, p].sort((a, b) => a.name.localeCompare(b.name));
              });
              addProduct(p);
              setUnknown(null);
              scanRef.current?.focus();
            }}
            onCancel={() => {
              setUnknown(null);
              scanRef.current?.focus();
            }}
          />
        )}

        <div>
          <input
            className="input py-2 text-sm"
            placeholder="Hoặc tìm sản phẩm theo tên (hàng không có mã vạch)…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {found.length > 0 && (
            <ul className="mt-1 divide-y divide-beige rounded-xl border border-beige-dark">
              {found.map((p) => (
                <li key={p.id}>
                  <button
                    className="flex w-full justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-cream"
                    onClick={() => {
                      addProduct(p);
                      setSearch("");
                    }}
                  >
                    <span>
                      {productLabel(p)}
                      {p.brand && <span className="block text-xs text-ink/50">{p.brand}</span>}
                    </span>
                    <span className="shrink-0 text-xs text-ink/50">{p.barcode ?? "chưa có mã vạch"}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* phiếu nhập */}
      <div className="card space-y-3 p-4">
        <h2 className="font-semibold text-navy">Phiếu nhập {wh ? `· ${wh.name}` : ""}</h2>
        {lines.length === 0 && <p className="text-sm text-ink/60">Chưa có sản phẩm. Quét mã vạch để thêm.</p>}
        {lines.map((l) => {
          const p = byId.get(l.productId);
          if (!p) return null;
          return (
            <div key={l.productId} className="rounded-xl border border-beige-dark p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">{productLabel(p)}</p>
                  <p className="text-xs text-ink/55">{[p.brand, p.barcode].filter(Boolean).join(" · ")}</p>
                </div>
                <button className="text-ink/40 hover:text-[#8A2323]" onClick={() => setLines((ls) => ls.filter((x) => x.productId !== l.productId))}>
                  ✕
                </button>
              </div>
              <div className="mt-2 space-y-2 text-xs">
                <PackQty value={l.pe} onChange={(pe) => setPe(l.productId, pe)} product={p} volUnit={volumeUnit(p.capacity, p.unit) === "g" ? "g" : "ml"} />
                <label className="flex items-center gap-1">
                  Hạn sử dụng
                  <input
                    type="date"
                    min={minExp}
                    className={`rounded-lg border px-2 py-1.5 text-sm ${l.exp ? "border-beige-dark" : "border-[#E0A526] bg-[#FFF8E8]"}`}
                    value={l.exp}
                    onChange={(e) => setLines((ls) => ls.map((x) => (x.productId === l.productId ? { ...x, exp: e.target.value } : x)))}
                  />
                </label>
              </div>
            </div>
          );
        })}
        <div className="rounded-xl border border-beige-dark p-3 text-sm">
          <p className="font-semibold text-navy">Nhập vào kho <span className="text-[#8A2323]">*</span></p>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
            {(["treatment", "retail"] as const).map((t) => (
              <label key={t} className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-navy"
                  checked={type === t}
                  onChange={(e) => {
                    setType(e.target.checked ? t : null);
                    setError(null);
                  }}
                />
                {WAREHOUSE_LABEL[t]}
              </label>
            ))}
          </div>
          {!type && <p className="mt-1 text-xs text-[#7A5600]">Tick chọn 1 kho trước khi lưu phiếu.</p>}
          {type && !wh && <p className="mt-1 text-xs text-[#8A2323]">Chi nhánh này chưa có kho loại này.</p>}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <input className="input py-2 text-sm" placeholder="Nhà cung cấp" list="ncc-list" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          <datalist id="ncc-list">
            {suppliers.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          <input className="input py-2 text-sm" placeholder="Ghi chú (không bắt buộc)" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        {/* chi phí khác */}
        <div className="space-y-2 rounded-xl bg-cream p-3">
          <p className="text-sm font-semibold text-navy">Chi phí <span className="font-normal text-ink/55">(tiền ship khi nhận hàng, chi phí khác…)</span></p>
          {extras.map((x) => (
            <div key={x.key} className="flex items-center gap-2">
              <input
                className="min-w-0 flex-1 rounded-lg border border-beige-dark bg-white px-3 py-2 text-sm"
                placeholder="Tên chi phí"
                value={x.label}
                onChange={(e) => setExtras((xs) => xs.map((y) => (y.key === x.key ? { ...y, label: e.target.value } : y)))}
              />
              <MoneyInput
                value={x.amount}
                onChange={(n) => setExtras((xs) => xs.map((y) => (y.key === x.key ? { ...y, amount: n } : y)))}
                className="w-28"
                ariaLabel="Số tiền"
              />
              <button className="px-1 text-ink/40 hover:text-[#8A2323]" onClick={() => setExtras((xs) => xs.filter((y) => y.key !== x.key))} aria-label="Xoá chi phí">
                ✕
              </button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            {EXTRA_PRESETS.map((label) => (
              <button
                key={label}
                className="rounded-full border border-navy/30 bg-white px-3 py-1.5 text-xs font-semibold text-navy"
                onClick={() => setExtras((xs) => [...xs, { key: Date.now(), label, amount: 0 }])}
              >
                + {label}
              </button>
            ))}
          </div>
          {extraTotal > 0 && <p className="text-right text-sm font-semibold text-navy">Tổng chi phí: {formatVnd(extraTotal)}</p>}
        </div>
        <p className="text-xs text-ink/55">Giá nhập sản phẩm do chủ spa nhập khi duyệt phiếu.</p>

        <button className="btn-primary w-full py-3" disabled={saving || lines.length === 0} onClick={save}>
          {saving ? "Đang lưu…" : "Lưu phiếu nhập"}
        </button>
        {error && <p className="text-sm text-[#8A2323]">{error}</p>}
        {done && <p className="rounded-lg bg-[#D6EDD8] px-3 py-2 text-sm text-[#22612A]">✓ {done}</p>}
      </div>

      {recent.length > 0 && (
        <div className="card p-0">
          <p className="px-4 pt-3 text-sm font-semibold text-navy">{recentTitle}</p>
          <p className="px-4 text-xs text-ink/55">Bấm vào phiếu để xem chi tiết.</p>
          <ul className="mt-1 divide-y divide-beige text-sm">
            {recent.map((r) => {
              const extras = (r.extra_costs ?? []).filter((x) => Number(x.amount) > 0);
              return (
                <li key={r.id}>
                  <details>
                    <summary className="flex cursor-pointer list-none justify-between gap-3 px-4 py-2 hover:bg-cream">
                      <span className="min-w-0">
                        <b>{r.code}</b> · {r.warehouses?.name}
                        <span className="block text-xs text-ink/55">
                          {formatTime(r.created_at)} {vnDate(r.created_at)} · {r.profiles?.full_name ?? "?"}
                          {r.supplier ? ` · ${r.supplier}` : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        {r.stock_receipt_items.reduce((a, m) => a + Number(m.quantity), 0)} đơn vị
                        <span className={`mt-0.5 block rounded-full px-2 py-0.5 text-[11px] ${r.status === "pending" ? "bg-[#FFE8BA] text-[#7A5600]" : r.status === "rejected" ? "bg-[#F6D5D5] text-[#8A2323]" : "bg-[#D6EDD8] text-[#22612A]"}`}>
                          {r.status === "pending" ? "Chờ duyệt giá" : r.status === "rejected" ? "Không duyệt" : "Đã duyệt"}
                        </span>
                      </span>
                    </summary>
                    <div className="space-y-2 bg-cream px-4 py-3 text-xs">
                      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                        <span className="text-ink/55">Kho nhận</span><span>{r.warehouses?.name ?? "—"}</span>
                        <span className="text-ink/55">Nhà cung cấp</span><span>{r.supplier ?? "—"}</span>
                        <span className="text-ink/55">Người lập</span><span>{r.profiles?.full_name ?? "—"} · {formatTime(r.created_at)} {vnDate(r.created_at)}</span>
                        {r.note && (<><span className="text-ink/55">Ghi chú</span><span>{r.note}</span></>)}
                        {r.status === "approved" && r.approved_at && (<><span className="text-ink/55">Đã duyệt</span><span>{formatTime(r.approved_at)} {vnDate(r.approved_at)} · hàng đã vào kho</span></>)}
                        {r.status === "rejected" && (<><span className="text-ink/55">Không duyệt</span><span className="text-[#8A2323]">{r.rejected_at ? `${vnDate(r.rejected_at)} · ` : ""}{r.reject_reason || "không ghi lý do"}</span></>)}
                        {r.status === "pending" && (<><span className="text-ink/55">Trạng thái</span><span>Chờ chủ spa duyệt giá – hàng chưa vào kho</span></>)}
                      </div>
                      <table className="w-full rounded-lg bg-white">
                        <thead>
                          <tr className="text-left text-ink/55">
                            <th className="px-2 py-1 font-normal">Sản phẩm</th>
                            <th className="px-2 py-1 text-right font-normal">SL</th>
                            <th className="px-2 py-1 text-right font-normal">HSD</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-beige">
                          {r.stock_receipt_items.map((it) => {
                            const p = byId.get(it.product_id);
                            return (
                              <tr key={it.id}>
                                <td className="px-2 py-1">{p ? productLabel(p) : "(sản phẩm đã xoá)"}</td>
                                <td className="px-2 py-1 text-right">
                                  {it.quantity}{p ? ` ${p.unit}` : ""}
                                  {it.pack_size ? <span className="block text-ink/55">{it.quantity / it.pack_size} hộp × {it.pack_size}</span> : null}
                                </td>
                                <td className={`px-2 py-1 text-right ${it.expiry_date ? "" : "text-[#7A5600]"}`}>{it.expiry_date ? vnDay(it.expiry_date) : "chưa nhập"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {extras.length > 0 && (
                        <p>
                          Chi phí: {extras.map((x) => `${x.label} ${formatVnd(Number(x.amount))}`).join(" · ")}
                        </p>
                      )}
                      {r.status === "approved" && <p className="text-ink/55">Số lượng là số chủ spa đã duyệt.</p>}
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {camera && <CameraScanner onScan={handleCode} onClose={() => setCamera(false)} />}

      <div className="action-bar fixed inset-x-0 z-10 border-t border-beige-dark bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <div className="min-w-0 flex-1 text-xs">
            {error ? (
              <p className="text-[#8A2323]">{error}</p>
            ) : done ? (
              <p className="text-[#22612A]">{done}</p>
            ) : (
              <p>
                {lines.length} sản phẩm · {totalQty} đơn vị{extraTotal > 0 ? ` · chi phí ${formatVnd(extraTotal)}` : ""}
              </p>
            )}
          </div>
          <button className="btn-primary" disabled={saving || lines.length === 0} onClick={save}>
            {saving ? "Đang lưu…" : "Lưu phiếu nhập"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Mã vạch chưa có: gắn cho sản phẩm có sẵn (hàng nhập từ sheet chưa có mã) hoặc tạo sản phẩm mới */
function UnknownBarcode({
  barcode,
  warehouseType,
  products,
  onLinked,
  onCancel,
}: {
  barcode: string;
  warehouseType: WarehouseType | null;
  products: Product[];
  onLinked: (p: Product) => void;
  onCancel: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [mode, setMode] = useState<"link" | "new">("link");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ brand: "", name: "", capacity: "", unit: "chai", category: "", retail: 0 });

  const candidates = useMemo(() => {
    const t = normalizeText(q.trim());
    return products
      .filter((p) => !p.barcode && !p.deleted_at)
      .filter((p) => !t || normalizeText(`${p.brand ?? ""} ${p.name} ${p.capacity ?? ""}`).includes(t))
      .slice(0, 8);
  }, [q, products]);

  async function link(p: Product) {
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.from("products").update({ barcode }).eq("id", p.id).select(PRODUCT_COLUMNS).single();
    setBusy(false);
    if (error) return setError(vnError(error.message));
    onLinked(data as Product);
  }

  async function create() {
    setBusy(true);
    setError(null);
    const { data, error } = await supabase
      .from("products")
      .insert({
        barcode,
        brand: form.brand,
        name: form.name,
        capacity: form.capacity,
        unit: form.unit,
        category: form.category || null,
        retail_price: form.retail || null,
        for_treatment: warehouseType === "treatment",
        for_retail: warehouseType === "retail",
      })
      .select(PRODUCT_COLUMNS)
      .single();
    setBusy(false);
    if (error) return setError(vnError(error.message));
    onLinked(data as Product);
  }

  const canCreate = form.brand.trim() && form.name.trim() && form.capacity.trim();

  return (
    <div className="space-y-3 rounded-xl border-2 border-[#E0A526] bg-[#FFF8E8] p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <p>
          Mã vạch <b className="font-mono">{barcode}</b> chưa có trong danh mục.
        </p>
        <button className="text-ink/50" onClick={onCancel}>✕</button>
      </div>
      <div className="flex gap-2 text-xs">
        <button className={`rounded-full px-3 py-1.5 font-semibold ${mode === "link" ? "bg-navy text-white" : "bg-white text-navy"}`} onClick={() => setMode("link")}>
          Gắn cho sản phẩm có sẵn
        </button>
        <button className={`rounded-full px-3 py-1.5 font-semibold ${mode === "new" ? "bg-navy text-white" : "bg-white text-navy"}`} onClick={() => setMode("new")}>
          Tạo sản phẩm mới
        </button>
      </div>

      {mode === "link" ? (
        <div>
          <input className="input bg-white py-2 text-sm" placeholder="Tìm sản phẩm chưa có mã vạch…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <ul className="mt-1 divide-y divide-beige rounded-xl border border-beige-dark bg-white">
            {candidates.length === 0 && <li className="px-3 py-2 text-xs text-ink/60">Không thấy — chọn “Tạo sản phẩm mới”.</li>}
            {candidates.map((p) => (
              <li key={p.id}>
                <button className="w-full px-3 py-2 text-left hover:bg-cream disabled:opacity-50" disabled={busy} onClick={() => link(p)}>
                  {productLabel(p)}
                  <span className="block text-xs text-ink/50">{[p.brand, p.category].filter(Boolean).join(" · ")}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <input className="input bg-white py-2 text-sm" placeholder="Tên nhãn hàng *" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} autoFocus />
          <input className="input bg-white py-2 text-sm" placeholder="Tên sản phẩm *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="input bg-white py-2 text-sm" placeholder="Dung tích * (vd 50ml, Hộp 10 ống x 5ml)" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
          <label className="flex items-center gap-2 text-xs">
            Đơn vị đếm
            <select className="flex-1 rounded-lg border border-beige-dark bg-white px-2 py-2 text-sm" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
              {UNITS.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </label>
          <input className="input bg-white py-2 text-sm" placeholder="Nhóm (vd Serum, Kem chống nắng)" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          <label className="flex items-center gap-2 text-xs">
            Giá niêm yết{warehouseType === "retail" ? " (bán lẻ)" : ""}
            <MoneyInput value={form.retail} onChange={(n) => setForm({ ...form, retail: n })} className="flex-1" ariaLabel="Giá niêm yết" />
          </label>
          <button className="btn-primary py-2 sm:col-span-2" disabled={busy || !canCreate} onClick={create}>
            {busy ? "Đang lưu…" : "Tạo sản phẩm + thêm vào phiếu"}
          </button>
        </div>
      )}
      {error && <p className="text-xs text-[#8A2323]">{error}</p>}
    </div>
  );
}
