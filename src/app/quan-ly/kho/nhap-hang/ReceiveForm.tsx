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
  type Product,
  type Warehouse,
  type WarehouseType,
} from "@/lib/inventory";
import MoneyInput from "@/components/MoneyInput";
import CameraScanner from "@/components/LazyCameraScanner";

export type RecentReceipt = {
  id: string;
  code: string;
  supplier: string | null;
  created_at: string;
  warehouses: { name: string } | null;
  profiles: { full_name: string | null } | null;
  stock_movements: { quantity: number }[];
};

type Line = { productId: string; qty: number; cost: number };

export default function ReceiveForm({
  branches,
  defaultBranchId,
  defaultType,
  warehouses,
  initialProducts,
  costs,
  recent,
}: {
  branches: { id: string; name: string }[];
  defaultBranchId: string;
  defaultType: WarehouseType;
  warehouses: Warehouse[];
  initialProducts: Product[];
  costs: Record<string, number | null>;
  recent: RecentReceipt[];
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const byBarcode = useMemo(() => new Map(products.filter((p) => p.barcode).map((p) => [p.barcode!, p])), [products]);

  const [branchId, setBranchId] = useState(defaultBranchId);
  const [type, setType] = useState<WarehouseType>(defaultType);
  const wh = warehouses.find((w) => w.branch_id === branchId && w.type === type);

  const [lines, setLines] = useState<Line[]>([]);
  const [supplier, setSupplier] = useState("");
  const [note, setNote] = useState("");
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

  function addProduct(p: Product, qty = 1) {
    setLines((ls) => {
      const i = ls.findIndex((l) => l.productId === p.id);
      if (i >= 0) return ls.map((l, k) => (k === i ? { ...l, qty: l.qty + qty } : l));
      return [{ productId: p.id, qty, cost: Number(costs[p.id] ?? 0) }, ...ls];
    });
    setFlash(`+${qty} ${productLabel(p)}`);
    setDone(null);
  }

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
      .filter((p) => normalizeText(`${p.brand ?? ""} ${p.name} ${p.capacity ?? ""}`).includes(q))
      .slice(0, 8);
  }, [search, products]);

  const totalQty = lines.reduce((a, l) => a + l.qty, 0);
  const totalCost = lines.reduce((a, l) => a + l.qty * l.cost, 0);

  async function save() {
    if (!wh || lines.length === 0) return;
    setSaving(true);
    setError(null);
    const { data, error } = await supabase.rpc("receive_stock", {
      p_warehouse_id: wh.id,
      p_supplier: supplier,
      p_note: note,
      p_items: lines.map((l) => ({ product_id: l.productId, quantity: l.qty, unit_cost: l.cost || null })),
    });
    setSaving(false);
    if (error) return setError(vnError(error.message));
    const { data: r } = await supabase.from("stock_receipts").select("code").eq("id", data as string).maybeSingle();
    setDone(`Đã lưu phiếu nhập ${r?.code ?? ""}: ${totalQty} đơn vị vào ${wh.name}.`);
    setLines([]);
    setSupplier("");
    setNote("");
    setFlash(null);
    router.refresh();
    scanRef.current?.focus();
  }

  return (
    <div className="space-y-4 pb-24">
      {/* kho nhận */}
      <div className="card space-y-3 p-4">
        {branches.length > 1 && (
          <select className="input py-2" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        )}
        <div className="flex gap-2">
          {(["treatment", "retail"] as const).map((t) => (
            <button
              key={t}
              className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold ${t === type ? "bg-navy text-white" : "bg-cream text-navy"}`}
              onClick={() => setType(t)}
            >
              Nhập vào {WAREHOUSE_LABEL[t].toLowerCase()}
            </button>
          ))}
        </div>
        {!wh && <p className="text-sm text-[#8A2323]">Chi nhánh này chưa có kho loại này.</p>}
      </div>

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
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                <span className="flex items-center gap-1">
                  <button className="h-8 w-8 rounded-lg bg-cream text-base font-bold" onClick={() => setLines((ls) => ls.map((x) => (x.productId === l.productId ? { ...x, qty: Math.max(1, x.qty - 1) } : x)))}>
                    −
                  </button>
                  <input
                    type="number"
                    min={1}
                    inputMode="numeric"
                    className="w-16 rounded-lg border border-beige-dark px-2 py-1.5 text-center text-sm"
                    value={l.qty}
                    onChange={(e) => {
                      const n = Math.max(1, Math.floor(Number(e.target.value) || 1));
                      setLines((ls) => ls.map((x) => (x.productId === l.productId ? { ...x, qty: n } : x)));
                    }}
                  />
                  <button className="h-8 w-8 rounded-lg bg-cream text-base font-bold" onClick={() => setLines((ls) => ls.map((x) => (x.productId === l.productId ? { ...x, qty: x.qty + 1 } : x)))}>
                    +
                  </button>
                  <span className="ml-1">{p.unit}</span>
                </span>
                <label className="flex items-center gap-1">
                  Giá nhập / {p.unit}
                  <MoneyInput
                    value={l.cost}
                    onChange={(n) => setLines((ls) => ls.map((x) => (x.productId === l.productId ? { ...x, cost: n } : x)))}
                    className="w-28"
                    ariaLabel="Giá nhập"
                  />
                </label>
                {l.cost > 0 && <span className="ml-auto text-ink/60">= {formatVnd(l.cost * l.qty)}</span>}
              </div>
            </div>
          );
        })}
        <div className="grid gap-2 sm:grid-cols-2">
          <input className="input py-2 text-sm" placeholder="Nhà cung cấp (không bắt buộc)" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          <input className="input py-2 text-sm" placeholder="Ghi chú (không bắt buộc)" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>

      {recent.length > 0 && (
        <div className="card p-0">
          <p className="px-4 pt-3 text-sm font-semibold text-navy">Phiếu nhập gần đây</p>
          <ul className="divide-y divide-beige text-sm">
            {recent.map((r) => (
              <li key={r.id} className="flex justify-between gap-3 px-4 py-2">
                <span className="min-w-0">
                  <b>{r.code}</b> · {r.warehouses?.name}
                  <span className="block text-xs text-ink/55">
                    {formatTime(r.created_at)} {new Date(r.created_at).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })} ·{" "}
                    {r.profiles?.full_name ?? "?"}
                    {r.supplier ? ` · ${r.supplier}` : ""}
                  </span>
                </span>
                <span className="shrink-0">{r.stock_movements.reduce((a, m) => a + Number(m.quantity), 0)} đơn vị</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {camera && <CameraScanner onScan={handleCode} onClose={() => setCamera(false)} />}

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-beige-dark bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <div className="min-w-0 flex-1 text-xs">
            {error ? (
              <p className="text-[#8A2323]">{error}</p>
            ) : done ? (
              <p className="text-[#22612A]">{done}</p>
            ) : (
              <p>
                {lines.length} sản phẩm · {totalQty} đơn vị{totalCost > 0 ? ` · ${formatVnd(totalCost)}` : ""}
              </p>
            )}
          </div>
          <button className="btn-primary" disabled={saving || !wh || lines.length === 0} onClick={save}>
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
  warehouseType: WarehouseType;
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
      .filter((p) => !p.barcode)
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
