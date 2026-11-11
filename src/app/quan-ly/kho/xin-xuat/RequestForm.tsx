"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { normalizeText, vnError } from "@/lib/format";
import { openLevelLabel, productLabel, type Product } from "@/lib/inventory";

type Line = { productId: string; qty: number };

export default function RequestForm({
  branches,
  branchId,
  products,
  qty,
  opened = {},
}: {
  branches: { id: string; name: string }[]; // có = được chọn chi nhánh (chủ / quản lý)
  branchId: string;
  products: Product[];
  qty: Record<string, number>;
  opened?: Record<string, number[]>; // chai đang mở của sản phẩm ở chi nhánh (mức còn %)
}) {
  const router = useRouter();
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const found = useMemo(() => {
    const q = normalizeText(search.trim());
    if (!q) return [];
    return products
      .filter((p) => normalizeText(`${p.brand ?? ""} ${p.name} ${p.used_in ?? ""} ${p.barcode ?? ""}`).includes(q))
      .slice(0, 10);
  }, [search, products]);

  function add(p: Product) {
    setLines((ls) => (ls.some((l) => l.productId === p.id) ? ls : [...ls, { productId: p.id, qty: 1 }]));
    setSearch("");
    setDone(null);
  }

  const problems = lines
    .filter((l) => l.qty > (qty[l.productId] ?? 0))
    .map((l) => `"${byId.get(l.productId)?.name}" chỉ còn ${qty[l.productId] ?? 0}`);

  async function submit() {
    setBusy(true);
    setError(null);
    const { data, error } = await createClient().rpc("create_stock_request", {
      p_branch_id: branchId,
      p_items: lines.map((l) => ({ product_id: l.productId, quantity: l.qty })),
      p_reason: reason,
    });
    setBusy(false);
    if (error) return setError(vnError(error.message));
    void data;
    setLines([]);
    setReason("");
    setDone("Đã gửi phiếu, chờ quản lý kho duyệt.");
    router.refresh();
  }

  return (
    <div className="card space-y-3 p-4">
      {branches.length > 1 && (
        <select className="input py-2" value={branchId} onChange={(e) => router.push(`/quan-ly/kho/xin-xuat?cn=${e.target.value}`)}>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>Kho liệu trình – {b.name}</option>
          ))}
        </select>
      )}
      <div>
        <input
          className="input py-2"
          placeholder="Gõ tên sản phẩm hoặc liệu trình (vd: BR, Peel, MNRF)…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {found.length > 0 && (
          <ul className="mt-1 divide-y divide-beige rounded-xl border border-beige-dark">
            {found.map((p) => {
              const have = qty[p.id] ?? 0;
              return (
                <li key={p.id}>
                  <button
                    className="flex w-full justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-cream disabled:opacity-50"
                    disabled={have <= 0}
                    onClick={() => add(p)}
                  >
                    <span className="min-w-0">
                      {productLabel(p)}
                      {p.used_in && <span className="block truncate text-xs text-ink/50">Dùng: {p.used_in}</span>}
                    </span>
                    <span className={`shrink-0 text-xs ${have <= 0 ? "text-[#8A2323]" : "text-ink/60"}`}>
                      {have <= 0 ? "hết hàng" : `còn ${have} ${p.unit}`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {lines.map((l) => {
        const p = byId.get(l.productId)!;
        const have = qty[l.productId] ?? 0;
        return (
          <div key={l.productId} className="flex items-center gap-2 rounded-xl border border-beige-dark px-3 py-2 text-sm">
            <span className="min-w-0 flex-1">
              {productLabel(p)}
              <span className="block text-xs text-ink/50">Kho còn {have} {p.unit}</span>
              {(opened[l.productId]?.length ?? 0) > 0 && (
                <span className="block text-xs font-semibold text-[#7A5600]">
                  ⚠ Chi nhánh đang mở {opened[l.productId].length} chai ({opened[l.productId].map(openLevelLabel).join(", ")}) — dùng hết rồi bấm “Hết chai” trước khi lấy chai mới
                </span>
              )}
            </span>
            <input
              type="number"
              min={1}
              max={have}
              inputMode="numeric"
              className={`w-16 rounded-lg border px-2 py-1.5 text-center ${l.qty > have ? "border-[#8A2323]" : "border-beige-dark"}`}
              value={l.qty}
              onChange={(e) => {
                const n = Math.max(1, Math.floor(Number(e.target.value) || 1));
                setLines((ls) => ls.map((x) => (x.productId === l.productId ? { ...x, qty: n } : x)));
              }}
            />
            <span className="w-10 text-xs">{p.unit}</span>
            <button className="text-ink/40 hover:text-[#8A2323]" onClick={() => setLines((ls) => ls.filter((x) => x.productId !== l.productId))}>
              ✕
            </button>
          </div>
        );
      })}

      {lines.length > 0 && (
        <>
          <input
            className="input py-2 text-sm"
            placeholder="Dùng cho khách / liệu trình nào? (vd: chị Lan – BR VIP O2)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {problems.length > 0 && <p className="text-xs text-[#8A2323]">{problems.join("; ")}</p>}
          {error && <p className="text-xs text-[#8A2323]">{error}</p>}
          <button className="btn-primary w-full" disabled={busy || problems.length > 0} onClick={submit}>
            {busy ? "Đang gửi…" : `Gửi phiếu xin ${lines.reduce((a, l) => a + l.qty, 0)} đơn vị`}
          </button>
        </>
      )}
      {done && <p className="rounded-lg bg-[#D6EDD8] px-3 py-2 text-sm text-[#22612A]">✓ {done}</p>}
    </div>
  );
}
