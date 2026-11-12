"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatVnd, normalizeText, vnError } from "@/lib/format";
import { productLabel, type Product, type WarehouseType } from "@/lib/inventory";
import { TileIconSvg, type TileIcon } from "@/components/StatTile";
import Modal from "@/components/Modal";
import { ProductForm } from "./san-pham/ProductEditor";

type Status = "in" | "low" | "out";
type StatusFilter = "all" | Status;
type ExpiryFilter = "all" | "soon" | "expired";

const STATUS: Record<Status, { label: string; cls: string }> = {
  in: { label: "Còn hàng", cls: "bg-[#D6EDD8] text-[#22612A]" },
  low: { label: "Sắp hết", cls: "bg-[#FFE8BA] text-[#7A5600]" },
  out: { label: "Hết hàng", cls: "bg-[#F6D5D5] text-[#8A2323]" },
};
const PAGE = 20;
const SOON_DAYS = 60; // HSD còn ≤ 60 ngày thì báo sắp hết hạn

function fmtDate(d: string) {
  return d.split("-").reverse().join("/");
}

export default function StockList({
  warehouseId,
  warehouseType,
  warehouseName,
  products,
  qty,
  canManage,
  canEdit,
  defaultPct,
  showCost,
}: {
  warehouseId: string;
  warehouseType: WarehouseType;
  warehouseName: string;
  products: Product[];
  qty: Record<string, number>;
  canManage: boolean;
  canEdit: boolean;
  defaultPct: number;
  showCost: boolean;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [group, setGroup] = useState("");
  const [expiry, setExpiry] = useState<ExpiryFilter>("all");
  const [showFilter, setShowFilter] = useState(false);
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const soonLimit = useMemo(() => new Date(Date.now() + SOON_DAYS * 86400000).toISOString().slice(0, 10), []);
  const stateOf = (p: Product): Status => {
    const q = qty[p.id] ?? 0;
    return q <= 0 ? "out" : q <= p.min_stock ? "low" : "in";
  };
  const expiryOf = (p: Product): "expired" | "soon" | null =>
    !p.expiry_date ? null : p.expiry_date < today ? "expired" : p.expiry_date <= soonLimit ? "soon" : null;
  const groupOf = (p: Product) => (warehouseType === "treatment" ? p.category : p.brand) ?? "Khác";
  const groups = useMemo(() => [...new Set(products.map(groupOf))].sort((a, b) => a.localeCompare(b, "vi")), [products]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    const q = normalizeText(query.trim());
    return products
      .filter((p) => !q || normalizeText(`${p.brand ?? ""} ${p.name} ${p.category ?? ""} ${p.barcode ?? ""} ${p.sku ?? ""}`).includes(q))
      .filter((p) => status === "all" || stateOf(p) === status)
      .filter((p) => !group || groupOf(p) === group)
      .filter((p) => expiry === "all" || (expiry === "expired" ? expiryOf(p) === "expired" : expiryOf(p) !== null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, query, status, group, expiry, qty]);
  useEffect(() => setPage(0), [query, status, group, expiry]);

  const count = (st: Status) => products.filter((p) => stateOf(p) === st).length;
  const total = products.reduce((a, p) => a + Math.max(0, qty[p.id] ?? 0), 0);
  const nLow = count("low");
  const nOut = count("out");
  const nExp = products.filter((p) => expiryOf(p)).length;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const view = rows.slice(page * PAGE, page * PAGE + PAGE);
  const filters = (status !== "all" ? 1 : 0) + (group ? 1 : 0) + (expiry !== "all" ? 1 : 0);

  function download() {
    const head = ["Sản phẩm", "Nhãn hàng", "Dung tích", warehouseType === "treatment" ? "Nhóm" : "Nhóm", "Mã vạch", "Tồn kho", "Đơn vị", "Tình trạng", "Hạn sử dụng", "Giá niêm yết"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = rows.map((p) =>
      [p.name, p.brand, p.capacity, p.category, p.barcode, qty[p.id] ?? 0, p.unit, STATUS[stateOf(p)].label, p.expiry_date ? fmtDate(p.expiry_date) : "", p.retail_price ?? ""]
        .map(esc)
        .join(","),
    );
    const blob = new Blob(["﻿" + [head.map(esc).join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ton-kho-${warehouseName.replace(/\s+/g, "-").toLowerCase()}-${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const tile = (key: StatusFilter, label: string, value: React.ReactNode, icon: TileIcon, foot: string, highlight?: boolean) => {
    const on = status === key && key !== "all";
    return (
      <button
        type="button"
        onClick={() => setStatus(on ? "all" : key)}
        className={`stat-tile text-left transition hover:-translate-y-0.5 ${
          highlight ? "!border-gold !bg-gold-soft ring-1 ring-gold/50" : ""
        } ${on ? "ring-2 !ring-navy" : ""}`}
      >
        <div className="flex items-start justify-between gap-2">
          <p className={`text-[13px] font-medium ${highlight ? "text-[#7A5600]" : "text-ink/60"}`}>{label}</p>
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl ${highlight ? "bg-gold/30 text-[#7A5600]" : "bg-gold-soft text-brown"}`}>
            <TileIconSvg name={icon} className="h-[18px] w-[18px]" />
          </span>
        </div>
        <p className={`mt-2 text-[1.6rem] font-bold leading-none tracking-tight tabular-nums sm:text-[1.85rem] ${highlight ? "text-[#7A5600]" : "text-navy"}`}>{value}</p>
        <p className={`mt-3 text-xs ${highlight ? "font-semibold text-[#7A5600]" : "text-ink/55"}`}>{foot}</p>
      </button>
    );
  };

  return (
    <div className="space-y-4">
      {/* 4 ô tổng quan – bấm để lọc */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {tile("all", "Tổng mặt hàng", products.length, "layers", `${total} đơn vị đang tồn`)}
        {tile("in", "Còn hàng", count("in"), "box", "Trên mức báo sắp hết")}
        {tile("low", "Sắp hết hàng", nLow, "alert", nLow ? "Cần nhập thêm – bấm để xem" : "Không có mặt hàng nào", nLow > 0)}
        {tile("out", "Hết hàng", nOut, "empty", nExp ? `${nExp} sản phẩm sắp / đã hết hạn` : "Tồn kho bằng 0")}
      </div>

      <div className="card p-0">
        {/* thanh công cụ */}
        <div className="flex flex-wrap items-center gap-2 border-b border-beige px-4 py-3 sm:px-5">
          <div className="relative min-w-[12rem] flex-1">
            <input
              className="input rounded-full py-2 pl-9 text-sm"
              placeholder="Tìm tên, nhãn hàng, nhóm, mã vạch…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/40" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
          </div>
          <div className="relative">
            <button className={`btn-outline py-2 ${filters ? "!bg-gold-soft" : ""}`} onClick={() => setShowFilter(!showFilter)}>
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M3 5h18M6 12h12M10 19h4" /></svg>
              Lọc{filters ? ` (${filters})` : ""}
            </button>
            {showFilter && (
              <div className="z-40 space-y-3 max-sm:fixed max-sm:inset-x-4 max-sm:top-24 sm:absolute sm:right-0 sm:top-full sm:mt-2 sm:w-72 rounded-2xl border border-beige-dark/70 bg-surface p-4 text-sm shadow-xl">
                <label className="block">
                  <span className="label text-xs">Tình trạng</span>
                  <select className="input py-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
                    <option value="all">Tất cả</option>
                    <option value="in">Còn hàng</option>
                    <option value="low">Sắp hết</option>
                    <option value="out">Hết hàng</option>
                  </select>
                </label>
                <label className="block">
                  <span className="label text-xs">{warehouseType === "treatment" ? "Nhóm sản phẩm" : "Nhãn hàng"}</span>
                  <select className="input py-2 text-sm" value={group} onChange={(e) => setGroup(e.target.value)}>
                    <option value="">Tất cả</option>
                    {groups.map((g) => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="label text-xs">Hạn sử dụng</span>
                  <select className="input py-2 text-sm" value={expiry} onChange={(e) => setExpiry(e.target.value as ExpiryFilter)}>
                    <option value="all">Tất cả</option>
                    <option value="soon">Sắp hết hạn / đã hết hạn (≤ {SOON_DAYS} ngày)</option>
                    <option value="expired">Đã hết hạn</option>
                  </select>
                </label>
                <div className="flex justify-between pt-1">
                  <button className="btn-ghost py-1.5 text-xs" onClick={() => { setStatus("all"); setGroup(""); setExpiry("all"); }}>Bỏ lọc</button>
                  <button className="btn-primary py-1.5 text-xs" onClick={() => setShowFilter(false)}>Xong</button>
                </div>
              </div>
            )}
          </div>
          <button className="btn-outline py-2" onClick={download} disabled={rows.length === 0} title="Tải danh sách đang xem (mở bằng Excel)">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
            Tải xuống
          </button>
          {canEdit && (
            <button className="btn-primary py-2" onClick={() => setAdding(true)}>
              <span className="text-base leading-none">+</span> Thêm
            </button>
          )}
        </div>

        {products.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-ink/60">
            Kho chưa có sản phẩm nào.{" "}
            {canManage && <Link href="/quan-ly/kho/nhap-hang" className="font-semibold text-navy underline">Nhập hàng</Link>}
          </p>
        ) : rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-ink/60">Không có sản phẩm phù hợp.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-beige text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">
                  <th className="px-4 py-3 sm:px-5">Sản phẩm</th>
                  <th className="hidden px-3 py-3 md:table-cell">{warehouseType === "treatment" ? "Nhóm" : "Nhãn hàng"}</th>
                  <th className="px-3 py-3 text-right">Tồn kho</th>
                  <th className="px-3 py-3">Tình trạng</th>
                  <th className="hidden px-3 py-3 sm:table-cell">Hạn sử dụng</th>
                  {warehouseType === "retail" && <th className="hidden px-3 py-3 text-right lg:table-cell">Giá niêm yết</th>}
                  {canManage && <th className="px-4 py-3 sm:px-5" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-beige/80">
                {view.map((p) => {
                  const q = qty[p.id] ?? 0;
                  const st = stateOf(p);
                  const ex = expiryOf(p);
                  const cols = 4 + (canManage ? 1 : 0) + (warehouseType === "retail" ? 1 : 0) + 1;
                  return (
                    <Fragment key={p.id}>
                      <tr className="align-top transition hover:bg-cream/50">
                        <td className="px-4 py-3 sm:px-5">
                          <Link href={`/quan-ly/kho/san-pham/${p.id}`} className="font-medium hover:text-navy hover:underline">{productLabel(p)}</Link>
                          <p className="mt-0.5 text-xs text-ink/50">
                            {[p.brand, p.used_in && warehouseType === "treatment" ? `Dùng: ${p.used_in}` : null].filter(Boolean).join(" · ")}
                            {!p.barcode && canManage && <span className="ml-1 text-[#7A5600]">· chưa có mã vạch</span>}
                          </p>
                          {/* điện thoại: HSD hiện dưới tên */}
                          {p.expiry_date && <p className={`mt-0.5 text-xs sm:hidden ${ex === "expired" ? "text-[#8A2323]" : ex === "soon" ? "text-[#7A5600]" : "text-ink/50"}`}>HSD {fmtDate(p.expiry_date)}</p>}
                        </td>
                        <td className="hidden px-3 py-3 text-ink/70 md:table-cell">{groupOf(p)}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-right">
                          <b className={`text-base ${st === "out" ? "text-[#8A2323]" : st === "low" ? "text-[#7A5600]" : "text-navy"}`}>{q}</b>{" "}
                          <span className="text-xs text-ink/50">{p.unit}</span>
                        </td>
                        <td className="px-3 py-3">
                          <span className={`chip ${STATUS[st].cls}`}>
                            <span className="h-1.5 w-1.5 rounded-full bg-current" />
                            {STATUS[st].label}
                          </span>
                        </td>
                        <td className="hidden whitespace-nowrap px-3 py-3 sm:table-cell">
                          {p.expiry_date ? (
                            <span className={ex === "expired" ? "font-semibold text-[#8A2323]" : ex === "soon" ? "font-semibold text-[#7A5600]" : "text-ink/70"}>
                              {fmtDate(p.expiry_date)}
                              {ex && <span className="block text-[11px] font-normal">{ex === "expired" ? "Đã hết hạn" : "Sắp hết hạn"}</span>}
                            </span>
                          ) : (
                            <span className="text-ink/30">—</span>
                          )}
                        </td>
                        {warehouseType === "retail" && (
                          <td className="hidden whitespace-nowrap px-3 py-3 text-right text-ink/70 lg:table-cell">{p.retail_price != null ? formatVnd(p.retail_price) : "—"}</td>
                        )}
                        {canManage && (
                          <td className="px-4 py-3 text-right sm:px-5">
                            <button className="rounded-full px-3 py-1 text-xs font-semibold text-navy ring-1 ring-beige-dark hover:bg-cream" onClick={() => setEditing(editing === p.id ? null : p.id)}>
                              Kiểm kê
                            </button>
                          </td>
                        )}
                      </tr>
                      {editing === p.id && (
                        <tr>
                          <td colSpan={cols} className="px-4 pb-3 sm:px-5">
                            <AdjustForm warehouseId={warehouseId} product={p} current={q} onDone={() => setEditing(null)} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* chia trang */}
        {rows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-beige px-4 py-3 text-xs text-ink/60 sm:px-5">
            <span>
              Hiện {page * PAGE + 1}–{Math.min(rows.length, (page + 1) * PAGE)} trên {rows.length} sản phẩm
            </span>
            {pages > 1 && (
              <div className="flex items-center gap-1">
                <button className="flex h-8 w-8 items-center justify-center rounded-full ring-1 ring-beige-dark disabled:opacity-40" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Trang trước">‹</button>
                {Array.from({ length: pages }, (_, i) => i)
                  .filter((i) => i === 0 || i === pages - 1 || Math.abs(i - page) <= 1)
                  .map((i, k, arr) => (
                    <Fragment key={i}>
                      {k > 0 && i - arr[k - 1] > 1 && <span className="px-1">…</span>}
                      <button
                        className={`flex h-8 min-w-8 items-center justify-center rounded-full px-2 font-semibold ${i === page ? "bg-navy text-white" : "text-navy hover:bg-cream"}`}
                        onClick={() => setPage(i)}
                      >
                        {i + 1}
                      </button>
                    </Fragment>
                  ))}
                <button className="flex h-8 w-8 items-center justify-center rounded-full ring-1 ring-beige-dark disabled:opacity-40" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label="Trang sau">›</button>
              </div>
            )}
          </div>
        )}
      </div>

      {adding && (
        <Modal title="Thêm sản phẩm mới" subtitle="Danh mục dùng chung cả 2 chi nhánh. Hàng vào kho qua phiếu Nhập hàng." onClose={() => setAdding(false)}>
          <ProductForm initialBarcode="" cost={showCost ? null : undefined} defaultPct={defaultPct} onDone={() => setAdding(false)} />
        </Modal>
      )}
    </div>
  );
}

function AdjustForm({ warehouseId, product, current, onDone }: { warehouseId: string; product: Product; current: number; onDone: () => void }) {
  const router = useRouter();
  const [counted, setCounted] = useState(String(Math.max(0, current)));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const n = Number(counted);
  const valid = counted !== "" && Number.isInteger(n) && n >= 0;

  async function save() {
    setBusy(true);
    setError(null);
    const { error } = await createClient().rpc("adjust_stock", {
      p_warehouse_id: warehouseId,
      p_product_id: product.id,
      p_counted: n,
      p_reason: reason,
    });
    setBusy(false);
    if (error) return setError(vnError(error.message));
    setDone(true);
    router.refresh();
  }
  if (done)
    return (
      <div className="mt-2 rounded-xl bg-cream p-3 text-xs">
        Đã ghi phiếu kiểm kho. Nếu lệch số, tồn kho được cập nhật sau khi chủ spa duyệt (trang Kho → Kiểm kho).{" "}
        <button className="font-semibold text-navy underline" onClick={onDone}>Đóng</button>
      </div>
    );

  return (
    <div className="mt-2 space-y-2 rounded-xl bg-cream p-3 text-xs">
      <p>Đếm thực tế trong kho, hệ thống ghi phiếu kiểm kho cho phần chênh lệch (lệch số cần chủ spa duyệt).</p>
      <div className="flex flex-wrap items-center gap-2">
        <span>Số đếm được</span>
        <input
          type="number"
          min={0}
          inputMode="numeric"
          className="w-20 rounded-lg border border-beige-dark px-2 py-1.5 text-right text-sm"
          value={counted}
          onChange={(e) => setCounted(e.target.value)}
        />
        <span>{product.unit}</span>
        {valid && n !== current && (
          <span className={n > current ? "text-[#22612A]" : "text-[#8A2323]"}>
            ({n > current ? "+" : ""}
            {n - current})
          </span>
        )}
      </div>
      <input
        className="w-full rounded-lg border border-beige-dark px-2 py-1.5 text-sm"
        placeholder="Lý do (bắt buộc): kiểm kê cuối tháng, hàng hỏng, vỡ…"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      {error && <p className="text-[#8A2323]">{error}</p>}
      <div className="flex justify-end gap-2">
        <button className="btn-ghost py-1.5" onClick={onDone}>Đóng</button>
        <button className="btn-primary py-1.5" disabled={busy || !valid || n === current || !reason.trim()} onClick={save}>
          {busy ? "Đang lưu…" : "Lưu kiểm kê"}
        </button>
      </div>
    </div>
  );
}
