"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatVnd, normalizeText, vnError } from "@/lib/format";
import { UNITS, productLabel, retailMinPrice, type Product } from "@/lib/inventory";
import MoneyInput from "@/components/MoneyInput";
import CameraScanner from "@/components/CameraScanner";

type Scope = "all" | "treatment" | "retail" | "nobarcode" | "inactive";

export default function ProductEditor({
  products,
  costs,
  defaultPct,
  isOwner,
}: {
  products: Product[];
  costs: Record<string, number | null>;
  defaultPct: number;
  isOwner: boolean;
}) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [newBarcode, setNewBarcode] = useState("");
  const [scanMsg, setScanMsg] = useState<string | null>(null);

  // Quét mã vạch: có trong danh mục thì mở sản phẩm đó, chưa có thì mở form tạo mới với mã vạch điền sẵn
  function handleScan(raw: string) {
    const code = raw.replace(/\s/g, "");
    setScanning(false);
    if (!code) return;
    const found = products.find((p) => p.barcode === code);
    if (found) {
      setScope(found.is_active ? "all" : "inactive");
      setQuery(code);
      setOpen(found.id);
      setScanMsg(`Mã ${code}: ${productLabel(found)}`);
    } else {
      setQuery("");
      setNewBarcode(code);
      setOpen("new");
      setScanMsg(`Mã ${code} chưa có trong danh mục. Điền thông tin để tạo sản phẩm mới, hoặc gắn mã này cho sản phẩm có sẵn (mở sản phẩm → ô Mã vạch).`);
    }
  }

  const rows = useMemo(() => {
    const q = normalizeText(query.trim());
    return products
      .filter((p) =>
        scope === "inactive"
          ? !p.is_active
          : p.is_active &&
            (scope === "all" ||
              (scope === "treatment" && p.for_treatment) ||
              (scope === "retail" && p.for_retail) ||
              (scope === "nobarcode" && !p.barcode)),
      )
      .filter((p) => !q || normalizeText(`${p.brand ?? ""} ${p.name} ${p.category ?? ""} ${p.barcode ?? ""}`).includes(q));
  }, [products, query, scope]);

  return (
    <div className="space-y-3">
      {isOwner && <DiscountSetting value={defaultPct} />}

      <div className="card space-y-3 p-4">
        <div className="flex gap-2">
          <input className="input flex-1 py-2" placeholder="Tìm tên, nhãn hàng hoặc mã vạch…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button className="btn-primary shrink-0 py-2" onClick={() => { setScanMsg(null); setScanning(true); }}>
            📷 Quét mã vạch
          </button>
        </div>
        {scanMsg && <p className="rounded-lg bg-cream px-3 py-2 text-xs">{scanMsg}</p>}
        <div className="flex flex-wrap gap-2 text-xs">
          {(
            [
              ["all", "Tất cả"],
              ["treatment", "Hàng liệu trình"],
              ["retail", "Hàng bán lẻ"],
              ["nobarcode", "Chưa có mã vạch"],
              ["inactive", "Ngừng dùng"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={`rounded-full px-3 py-1.5 font-semibold ${scope === k ? "bg-navy text-white" : "bg-cream text-navy"}`} onClick={() => setScope(k)}>
              {label}
            </button>
          ))}
          <button className="ml-auto rounded-full bg-[#D6EDD8] px-3 py-1.5 font-semibold text-[#22612A]" onClick={() => { setNewBarcode(""); setOpen(open === "new" ? null : "new"); }}>
            + Sản phẩm mới
          </button>
        </div>
        {open === "new" && <ProductForm key={newBarcode} initialBarcode={newBarcode} cost={null} defaultPct={defaultPct} onDone={() => setOpen(null)} />}
      </div>

      <div className="card p-0">
        <p className="px-4 pt-3 text-xs text-ink/60">{rows.length} sản phẩm</p>
        <ul className="divide-y divide-beige">
          {rows.map((p) => (
            <li key={p.id} className="px-4 py-2.5 text-sm">
              <button className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setOpen(open === p.id ? null : p.id)}>
                <span className="min-w-0">
                  <span className="font-medium">{productLabel(p)}</span>
                  <span className="block text-xs text-ink/55">
                    {[p.brand ?? "(chưa có nhãn hàng)", p.category, p.barcode ?? "chưa có mã vạch"].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="shrink-0 text-right text-xs">
                  {p.retail_price != null && <span className="block">{formatVnd(p.retail_price)}</span>}
                  <span className="text-ink/50">
                    {[p.for_treatment && "liệu trình", p.for_retail && "bán lẻ"].filter(Boolean).join(" + ") || "—"}
                  </span>
                </span>
              </button>
              {open === p.id && <ProductForm product={p} cost={costs[p.id] ?? null} defaultPct={defaultPct} onDone={() => setOpen(null)} />}
            </li>
          ))}
        </ul>
      </div>
      {scanning && <CameraScanner onScan={handleScan} onClose={() => setScanning(false)} />}
    </div>
  );
}

function DiscountSetting({ value }: { value: number }) {
  const router = useRouter();
  const [pct, setPct] = useState(String(value));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const n = Number(pct);

  async function save() {
    setBusy(true);
    setMsg(null);
    const { error } = await createClient().rpc("set_retail_max_discount", { p_pct: n });
    setBusy(false);
    setMsg(error ? vnError(error.message) : "Đã lưu.");
    router.refresh();
  }

  return (
    <div className="card space-y-2 p-4 text-sm">
      <p className="font-semibold text-navy">Giảm tối đa khi KTV / lễ tân bán lẻ</p>
      <p className="text-xs text-ink/60">
        KTV / lễ tân chỉ được giảm tối đa mức này, không giảm sâu hơn (giá bán thấp nhất = giá niêm yết × (100% − mức này)). Sản phẩm nào cần mức riêng thì sửa trong sản phẩm đó; đặt 0% = không được giảm.
      </p>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          max={100}
          className="w-20 rounded-lg border border-beige-dark px-2 py-1.5 text-right"
          value={pct}
          onChange={(e) => setPct(e.target.value)}
        />
        <span>%</span>
        <span className="text-xs text-ink/60">vd giá 1.000.000đ → bán thấp nhất {formatVnd(retailMinPrice(1000000, null, Number.isFinite(n) ? n : 0))}</span>
        <button className="btn-primary ml-auto py-1.5" disabled={busy || !(n >= 0 && n <= 100) || n === value} onClick={save}>
          Lưu
        </button>
      </div>
      {msg && <p className="text-xs">{msg}</p>}
    </div>
  );
}

function ProductForm({
  product,
  initialBarcode,
  cost,
  defaultPct,
  onDone,
}: {
  product?: Product;
  initialBarcode?: string;
  cost: number | null;
  defaultPct: number;
  onDone: () => void;
}) {
  const router = useRouter();
  const [f, setF] = useState({
    brand: product?.brand ?? "",
    name: product?.name ?? "",
    capacity: product?.capacity ?? "",
    unit: product?.unit ?? "chai",
    barcode: product?.barcode ?? initialBarcode ?? "",
    category: product?.category ?? "",
    used_in: product?.used_in ?? "",
    retail_price: Number(product?.retail_price ?? 0),
    cost_price: Number(cost ?? 0),
    pct: product?.max_staff_discount_pct == null ? "" : String(product.max_staff_discount_pct),
    min_stock: String(product?.min_stock ?? 0),
    for_treatment: product?.for_treatment ?? false,
    for_retail: product?.for_retail ?? true,
    is_active: product?.is_active ?? true,
    note: product?.note ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));

  const pctNum = f.pct === "" ? null : Number(f.pct);
  // sản phẩm mới bắt buộc đủ nhãn hàng + tên + dung tích (hàng cũ nhập từ sheet có thể thiếu nhãn hàng)
  const valid =
    f.name.trim() && (product || (f.brand.trim() && f.capacity.trim())) && (pctNum === null || (pctNum >= 0 && pctNum <= 100));

  async function save() {
    setBusy(true);
    setError(null);
    const row = {
      brand: f.brand,
      name: f.name,
      capacity: f.capacity,
      unit: f.unit,
      barcode: f.barcode,
      category: f.category || null,
      used_in: f.used_in || null,
      retail_price: f.retail_price || null,
      cost_price: f.cost_price || null,
      max_staff_discount_pct: pctNum,
      min_stock: Math.max(0, Math.floor(Number(f.min_stock) || 0)),
      for_treatment: f.for_treatment,
      for_retail: f.for_retail,
      is_active: f.is_active,
      note: f.note || null,
    };
    const supabase = createClient();
    const { error } = product
      ? await supabase.from("products").update(row).eq("id", product.id)
      : await supabase.from("products").insert(row);
    setBusy(false);
    if (error) return setError(vnError(error.message));
    onDone();
    router.refresh();
  }

  const input = "w-full rounded-lg border border-beige-dark bg-white px-2 py-1.5 text-sm";
  return (
    <div className="mt-2 grid gap-2 rounded-xl bg-cream p-3 text-xs sm:grid-cols-2">
      <div className="sm:col-span-2">
        <span>Mã vạch</span>
        <div className="flex gap-2">
          <input className={`${input} font-mono`} value={f.barcode} onChange={(e) => set({ barcode: e.target.value })} placeholder="bấm Quét, dùng máy quét hoặc gõ tay" />
          <button type="button" className="btn-primary shrink-0 py-1.5" onClick={() => setScanning(true)}>📷 Quét</button>
        </div>
        {scanning && (
          <CameraScanner
            onScan={(code) => {
              set({ barcode: code.replace(/\s/g, "") });
              setScanning(false);
            }}
            onClose={() => setScanning(false)}
          />
        )}
      </div>
      <label>Nhãn hàng{product ? "" : " *"}<input className={input} value={f.brand} onChange={(e) => set({ brand: e.target.value })} /></label>
      <label>Tên sản phẩm *<input className={input} value={f.name} onChange={(e) => set({ name: e.target.value })} /></label>
      <label>Dung tích / quy cách{product ? "" : " *"}<input className={input} value={f.capacity} onChange={(e) => set({ capacity: e.target.value })} placeholder="50ml, Hộp 10 ống x 5ml" /></label>
      <label>
        Đơn vị đếm tồn kho
        <select className={input} value={f.unit} onChange={(e) => set({ unit: e.target.value })}>
          {[...new Set([f.unit, ...UNITS])].map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
      </label>
      <label>Nhóm<input className={input} value={f.category} onChange={(e) => set({ category: e.target.value })} /></label>
      <label className="sm:col-span-2">Dùng trong liệu trình<input className={input} value={f.used_in} onChange={(e) => set({ used_in: e.target.value })} /></label>
      <label>
        Giá niêm yết (bán lẻ)
        <MoneyInput value={f.retail_price} onChange={(n) => set({ retail_price: n })} className="w-full" ariaLabel="Giá niêm yết" />
      </label>
      <label>
        Giá nhập
        <MoneyInput value={f.cost_price} onChange={(n) => set({ cost_price: n })} className="w-full" ariaLabel="Giá nhập" />
      </label>
      <label>
        Giảm tối đa riêng (%) – bỏ trống = theo mức chung {defaultPct}%
        <input type="number" min={0} max={100} className={input} value={f.pct} onChange={(e) => set({ pct: e.target.value })} />
        {f.retail_price > 0 && (
          <span className="text-ink/60">Bán thấp nhất {formatVnd(retailMinPrice(f.retail_price, pctNum, defaultPct))}</span>
        )}
      </label>
      <label>
        Báo sắp hết khi còn ≤
        <input type="number" min={0} className={input} value={f.min_stock} onChange={(e) => set({ min_stock: e.target.value })} />
      </label>
      <label className="sm:col-span-2">Ghi chú<input className={input} value={f.note} onChange={(e) => set({ note: e.target.value })} /></label>
      <div className="flex flex-wrap gap-4 sm:col-span-2">
        <label className="flex items-center gap-1"><input type="checkbox" checked={f.for_treatment} onChange={(e) => set({ for_treatment: e.target.checked })} /> Hàng liệu trình</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={f.for_retail} onChange={(e) => set({ for_retail: e.target.checked })} /> Hàng bán lẻ</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={f.is_active} onChange={(e) => set({ is_active: e.target.checked })} /> Đang dùng</label>
      </div>
      {error && <p className="text-[#8A2323] sm:col-span-2">{error}</p>}
      <div className="flex justify-end gap-2 sm:col-span-2">
        <button className="btn-ghost py-1.5" onClick={onDone}>Đóng</button>
        <button className="btn-primary py-1.5" disabled={busy || !valid} onClick={save}>{busy ? "Đang lưu…" : product ? "Lưu" : "Tạo sản phẩm"}</button>
      </div>
    </div>
  );
}
