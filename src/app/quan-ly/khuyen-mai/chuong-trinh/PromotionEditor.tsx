"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatVnd, normalizeText, todayVn, vnError } from "@/lib/format";
import MoneyInput from "@/components/MoneyInput";
import { KIND_LABEL, dmy, isOpen, periodText, sortedItems, type Promotion } from "@/lib/promotions";

export type Pickable = {
  type: "service" | "package" | "product";
  id: string;
  label: string;
  search: string;
  price: number | null;
  note: string;
};

type Row = { key: number; id: string | null; type: Pickable["type"]; refId: string; label: string; listPrice: number | null; promoPrice: number; quantity: number };
type Draft = {
  id: string | null;
  name: string;
  kind: Promotion["kind"];
  description: string;
  terms: string;
  start_date: string;
  end_date: string;
  redeem_until: string;
  branch_id: string;
  new_customers_only: boolean;
  max_slots: string;
  per_customer_limit: string;
  show_online: boolean;
  is_active: boolean;
  rows: Row[];
};

const KIND_HINT: Record<Promotion["kind"], string> = {
  discount: "Giá thấp hơn cho 1 hay nhiều dịch vụ / sản phẩm, VD: Glow MN chỉ 990k trong tháng 11",
  package: "Một gói combo bán giá đặc biệt (có thể dùng gói đã “ngừng bán” để chỉ bán qua khuyến mãi)",
  first_visit: "Giá trải nghiệm chỉ cho khách chưa từng làm / mua ở Moana; mỗi khách 1 lần",
  gift: "Mua món chính giá thường (hoặc giá KM) + món tặng giá 0đ, VD: mua gói X tặng 1 buổi Y",
};

let seq = 1;

function toDraft(p: Promotion | null): Draft {
  if (!p) {
    return {
      id: null,
      name: "",
      kind: "discount",
      description: "",
      terms: "",
      start_date: todayVn(),
      end_date: "",
      redeem_until: "",
      branch_id: "",
      new_customers_only: false,
      max_slots: "",
      per_customer_limit: "1",
      show_online: true,
      is_active: true,
      rows: [],
    };
  }
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    description: p.description ?? "",
    terms: p.terms ?? "",
    start_date: p.start_date ?? "",
    end_date: p.end_date ?? "",
    redeem_until: p.redeem_until ?? "",
    branch_id: p.branch_id ?? "",
    new_customers_only: p.new_customers_only,
    max_slots: p.max_slots === null ? "" : String(p.max_slots),
    per_customer_limit: String(p.per_customer_limit),
    show_online: p.show_online,
    is_active: p.is_active,
    rows: sortedItems(p).map((i) => ({
      key: seq++,
      id: i.id,
      type: i.item_type,
      refId: (i.service_id ?? i.package_id ?? i.product_id)!,
      label: i.label,
      listPrice: i.list_price === null ? null : Number(i.list_price),
      promoPrice: Number(i.promo_price),
      quantity: i.quantity,
    })),
  };
}

export default function PromotionEditor({
  promotions,
  branches,
  pickables,
  taken,
}: {
  promotions: Promotion[];
  branches: { id: string; name: string }[];
  pickables: Pickable[];
  taken: Record<string, number>;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const branchName = new Map(branches.map((b) => [b.id, b.name]));

  const found = useMemo(() => {
    const q = normalizeText(query.trim());
    if (!q) return [];
    return pickables.filter((p) => normalizeText(p.search).includes(q)).slice(0, 10);
  }, [query, pickables]);

  function set<K extends keyof Draft>(k: K, v: Draft[K]) {
    setDraft((d) => (d ? { ...d, [k]: v } : d));
  }
  function setRow(key: number, patch: Partial<Row>) {
    setDraft((d) => (d ? { ...d, rows: d.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) } : d));
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    const { error } = await createClient().rpc("save_promotion", {
      p_id: draft.id,
      p: {
        name: draft.name,
        kind: draft.kind,
        description: draft.description,
        terms: draft.terms,
        start_date: draft.start_date,
        end_date: draft.end_date,
        redeem_until: draft.redeem_until,
        branch_id: draft.branch_id,
        new_customers_only: draft.new_customers_only,
        max_slots: draft.max_slots,
        per_customer_limit: draft.per_customer_limit,
        show_online: draft.show_online,
        is_active: draft.is_active,
      },
      p_items: draft.rows.map((r) => ({ id: r.id, type: r.type, ref_id: r.refId, promo_price: r.promoPrice, quantity: r.quantity })),
    });
    setSaving(false);
    if (error) return setError(vnError(error.message));
    setDraft(null);
    router.refresh();
  }

  if (draft) {
    const problems: string[] = [];
    if (!draft.name.trim()) problems.push("Nhập tên chương trình.");
    if (draft.rows.length === 0) problems.push("Thêm ít nhất 1 dịch vụ / gói / sản phẩm.");
    if (draft.start_date && draft.end_date && draft.end_date < draft.start_date) problems.push("Ngày kết thúc trước ngày bắt đầu.");
    if (draft.redeem_until && draft.end_date && draft.redeem_until < draft.end_date) problems.push("Hạn dùng phải từ ngày kết thúc trở đi.");
    draft.rows.forEach((r) => {
      if (r.listPrice !== null && r.promoPrice > r.listPrice) problems.push(`"${r.label}": giá KM cao hơn giá niêm yết.`);
    });
    const total = draft.rows.reduce((a, r) => a + r.promoPrice * r.quantity, 0);

    return (
      <div className="space-y-4 pb-24">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-navy">{draft.id ? "Sửa khuyến mãi" : "Tạo khuyến mãi"}</h1>
          <button className="btn-ghost" onClick={() => setDraft(null)}>← Danh sách</button>
        </div>

        <div className="card space-y-3">
          <label className="block">
            <span className="label">Tên chương trình</span>
            <input className="input py-2" value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder="VD: Glow tháng 11 – chỉ 990k" />
          </label>
          <div>
            <span className="label">Kiểu khuyến mãi</span>
            <div className="grid gap-2 sm:grid-cols-2">
              {(Object.keys(KIND_LABEL) as Promotion["kind"][]).map((k) => (
                <button
                  key={k}
                  className={`rounded-xl border px-3 py-2 text-left text-sm ${draft.kind === k ? "border-navy bg-[#DCE3F5]/50" : "border-beige-dark"}`}
                  onClick={() =>
                    setDraft((d) =>
                      d ? { ...d, kind: k, new_customers_only: k === "first_visit" ? true : d.new_customers_only, per_customer_limit: k === "first_visit" ? "1" : d.per_customer_limit } : d,
                    )
                  }
                >
                  <b className="text-navy">{KIND_LABEL[k]}</b>
                  <span className="block text-xs text-ink/60">{KIND_HINT[k]}</span>
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="label">Giới thiệu (khách xem)</span>
            <textarea className="input py-2" rows={3} value={draft.description} onChange={(e) => set("description", e.target.value)} />
          </label>
          <label className="block">
            <span className="label">Điều kiện áp dụng (khách xem)</span>
            <textarea className="input py-2" rows={2} value={draft.terms} onChange={(e) => set("terms", e.target.value)} placeholder="VD: Không áp dụng cùng ưu đãi khác" />
          </label>
        </div>

        {/* MÓN */}
        <div className="card space-y-3">
          <h2 className="font-semibold text-navy">Dịch vụ / gói / sản phẩm và giá khuyến mãi</h2>
          {draft.rows.length === 0 && <p className="text-sm text-ink/60">Chưa có món nào.</p>}
          {draft.rows.map((r) => {
            const pct = r.listPrice ? Math.round((1 - r.promoPrice / r.listPrice) * 100) : null;
            return (
              <div key={r.key} className="rounded-xl border border-beige-dark p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium">
                    {r.label}
                    <span className="ml-1 text-xs text-ink/50">
                      {r.type === "service" ? "dịch vụ" : r.type === "package" ? "gói" : "sản phẩm"} · niêm yết {formatVnd(r.listPrice)}
                    </span>
                  </p>
                  <button className="text-ink/40 hover:text-[#8A2323]" onClick={() => set("rows", draft.rows.filter((x) => x.key !== r.key))}>✕</button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                  <label className="flex items-center gap-1">
                    Giá KM
                    <MoneyInput
                      value={r.promoPrice}
                      onChange={(n) => setRow(r.key, { promoPrice: n })}
                      className={`w-32 ${r.listPrice !== null && r.promoPrice > r.listPrice ? "border-[#8A2323]" : ""}`}
                      ariaLabel="Giá khuyến mãi"
                    />
                  </label>
                  {r.listPrice !== null && (
                    <label className="flex items-center gap-1">
                      hoặc giảm
                      <input
                        type="number"
                        min={0}
                        max={100}
                        className="w-16 rounded-lg border border-beige-dark px-2 py-1.5 text-right"
                        value={pct ?? ""}
                        onChange={(e) => {
                          const v = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                          setRow(r.key, { promoPrice: Math.round((r.listPrice! * (100 - v)) / 100 / 1000) * 1000 });
                        }}
                      />
                      %
                    </label>
                  )}
                  <button className="rounded-full bg-[#D6EDD8] px-3 py-1 font-semibold text-[#22612A]" onClick={() => setRow(r.key, { promoPrice: 0 })}>
                    Tặng (0đ)
                  </button>
                  <label className="flex items-center gap-1">
                    Số lượng
                    <input
                      type="number"
                      min={1}
                      max={50}
                      className="w-14 rounded-lg border border-beige-dark px-2 py-1.5"
                      value={r.quantity}
                      onChange={(e) => setRow(r.key, { quantity: Math.max(1, Math.min(50, Math.floor(Number(e.target.value) || 1))) })}
                    />
                  </label>
                </div>
              </div>
            );
          })}
          <div>
            <input className="input py-2" placeholder="+ Thêm dịch vụ, gói combo hoặc sản phẩm (gõ tên)" value={query} onChange={(e) => setQuery(e.target.value)} />
            {found.length > 0 && (
              <ul className="mt-1 divide-y divide-beige rounded-xl border border-beige-dark">
                {found.map((p) => (
                  <li key={`${p.type}-${p.id}`}>
                    <button
                      className="flex w-full justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-cream"
                      onClick={() => {
                        set("rows", [
                          ...draft.rows,
                          { key: seq++, id: null, type: p.type, refId: p.id, label: p.label, listPrice: p.price, promoPrice: p.price ?? 0, quantity: 1 },
                        ]);
                        setQuery("");
                      }}
                    >
                      <span>
                        {p.label} <span className="text-xs text-ink/50">{p.note}</span>
                      </span>
                      <span className="shrink-0 text-ink/60">{formatVnd(p.price)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {draft.rows.length > 1 && (
            <p className="flex justify-between border-t border-beige pt-2 text-sm">
              <span>Tổng nếu khách dùng hết</span>
              <b className="text-navy">{formatVnd(total)}</b>
            </p>
          )}
          <p className="text-xs text-ink/60">
            Khi thu tiền, lễ tân áp từng món. Giá khuyến mãi không tính là giảm giá (không cần chủ duyệt); giảm chung cả hoá đơn không áp thêm vào món khuyến mãi.
          </p>
        </div>

        {/* THỜI GIAN + GIỚI HẠN */}
        <div className="card space-y-3 text-sm">
          <h2 className="font-semibold text-navy">Thời gian & giới hạn</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="label">Bắt đầu nhận đăng ký</span>
              <input type="date" className="input py-2" value={draft.start_date} onChange={(e) => set("start_date", e.target.value)} />
            </label>
            <label className="block">
              <span className="label">Kết thúc đăng ký</span>
              <input type="date" className="input py-2" value={draft.end_date} onChange={(e) => set("end_date", e.target.value)} />
            </label>
            <label className="block">
              <span className="label">Hạn dùng ưu đãi</span>
              <input type="date" className="input py-2" value={draft.redeem_until} onChange={(e) => set("redeem_until", e.target.value)} />
            </label>
          </div>
          <p className="text-xs text-ink/60">Bỏ trống ngày kết thúc = không hạn. Bỏ trống hạn dùng = dùng được đến hết ngày kết thúc đăng ký.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="label">Chi nhánh</span>
              <select className="input py-2" value={draft.branch_id} onChange={(e) => set("branch_id", e.target.value)}>
                <option value="">Cả 2 chi nhánh</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="label">Tổng số suất</span>
              <input
                type="number"
                min={1}
                className="input py-2"
                placeholder="Không giới hạn"
                value={draft.max_slots}
                onChange={(e) => set("max_slots", e.target.value.replace(/\D/g, ""))}
              />
            </label>
            <label className="block">
              <span className="label">Mỗi khách tối đa</span>
              <input
                type="number"
                min={1}
                className="input py-2"
                value={draft.per_customer_limit}
                onChange={(e) => set("per_customer_limit", e.target.value.replace(/\D/g, ""))}
              />
            </label>
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={draft.new_customers_only} onChange={(e) => set("new_customers_only", e.target.checked)} />
            Chỉ khách lần đầu (chưa từng có hoá đơn / lịch hoàn thành ở Moana)
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={draft.show_online} onChange={(e) => set("show_online", e.target.checked)} />
            Hiện trên web cho khách tự đăng ký (bỏ chọn = chỉ nhân viên đăng ký hộ tại quầy)
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={draft.is_active} onChange={(e) => set("is_active", e.target.checked)} />
            Đang chạy (bỏ chọn = dừng nhận đăng ký mới; khách đã xác nhận vẫn dùng được đến hạn)
          </label>
        </div>

        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-beige-dark bg-white/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <p className="min-w-0 flex-1 text-xs text-[#8A2323]">{error ?? problems[0] ?? ""}</p>
            <button className="btn-primary" disabled={saving || problems.length > 0} onClick={save}>
              {saving ? "Đang lưu…" : "Lưu chương trình"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-navy">Chương trình khuyến mãi</h1>
          <p className="text-sm text-ink/70">Tạo ưu đãi để khách đăng ký trên web, lễ tân áp giá khi thu tiền.</p>
        </div>
        <button className="btn-primary" onClick={() => setDraft(toDraft(null))}>+ Tạo mới</button>
      </div>
      {promotions.length === 0 && <p className="card text-sm text-ink/60">Chưa có chương trình nào.</p>}
      {promotions.map((p) => {
        const open = isOpen(p);
        const used = taken[p.id] ?? 0;
        return (
          <button key={p.id} className="card block w-full p-4 text-left text-sm hover:border-navy" onClick={() => setDraft(toDraft(p))}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-navy">{p.name}</p>
                <p className="text-xs text-ink/60">
                  {KIND_LABEL[p.kind]} · {periodText(p)}
                  {p.redeem_until ? ` · dùng đến ${dmy(p.redeem_until)}` : ""} · {p.branch_id ? branchName.get(p.branch_id) : "cả 2 chi nhánh"}
                  {p.new_customers_only ? " · khách lần đầu" : ""}
                  {!p.show_online ? " · chỉ tại quầy" : ""}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
                  open ? "bg-[#D6EDD8] text-[#22612A]" : p.is_active ? "bg-[#FFE8BA] text-[#7A5600]" : "bg-[#ECECEC] text-[#666]"
                }`}
              >
                {open ? "Đang nhận đăng ký" : p.is_active ? "Ngoài thời gian" : "Đã dừng"}
              </span>
            </div>
            <p className="mt-1 text-xs">
              {sortedItems(p)
                .map((i) => `${i.label}${i.quantity > 1 ? ` ×${i.quantity}` : ""}: ${Number(i.promo_price) === 0 ? "tặng" : formatVnd(Number(i.promo_price))}`)
                .join(" · ")}
            </p>
            <p className="mt-1 text-xs text-ink/60">
              Đã đăng ký {used}
              {p.max_slots !== null ? ` / ${p.max_slots} suất` : ""}
            </p>
          </button>
        );
      })}
    </div>
  );
}
