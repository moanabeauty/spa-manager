"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatVnd, normalizeText, vnError } from "@/lib/format";

export type MenuService = {
  id: string;
  category_id: string | null;
  name: string;
  name_en: string | null;
  duration_minutes: number;
  price: number | null;
  member_price: number | null;
  technician_fee: number;
  card_allowed: boolean;
  commission_eligible: boolean;
  fee_once_per_visit: boolean;
  is_active: boolean;
  branch_id: string | null;
  menu_tier: "public" | "members";
  followup_days: number | null;
  recall_days: number | null;
};
type Category = { id: string; name: string; sort_order: number };
type Draft = Partial<Omit<MenuService, "id">>;

const FIELDS: (keyof Draft)[] = [
  "category_id", "name", "name_en", "duration_minutes", "price", "member_price",
  "technician_fee", "card_allowed", "commission_eligible", "fee_once_per_visit", "is_active", "branch_id",
  "menu_tier", "followup_days", "recall_days",
];

/** "1.200.000" -> 1200000; "" -> null */
function parseMoney(s: string): number | null {
  const d = s.replace(/\D/g, "");
  return d === "" ? null : Number(d);
}
function moneyInput(n: number | null | undefined): string {
  return n === null || n === undefined ? "" : new Intl.NumberFormat("vi-VN").format(n);
}

export default function MenuEditor({
  categories,
  services,
  branches,
}: {
  categories: Category[];
  services: MenuService[];
  branches: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [query, setQuery] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [tierFilter, setTierFilter] = useState<"" | "public" | "members">("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [adding, setAdding] = useState(false);

  const val = <K extends keyof MenuService>(s: MenuService, k: K): MenuService[K] =>
    (k in (drafts[s.id] ?? {}) ? (drafts[s.id] as MenuService)[k] : s[k]);

  function edit(id: string, patch: Draft) {
    setMsg(null);
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  // chỉ giữ những trường thật sự khác bản gốc
  const changes = useMemo(() => {
    const out: { id: string; name: string; patch: Draft }[] = [];
    for (const s of services) {
      const d = drafts[s.id];
      if (!d) continue;
      const patch: Draft = {};
      for (const f of FIELDS) {
        if (f in d && (d as Record<string, unknown>)[f] !== (s as Record<string, unknown>)[f]) {
          (patch as Record<string, unknown>)[f] = (d as Record<string, unknown>)[f];
        }
      }
      if (Object.keys(patch).length) out.push({ id: s.id, name: s.name, patch });
    }
    return out;
  }, [drafts, services]);
  const changedIds = new Set(changes.map((c) => c.id));

  const groups = useMemo(() => {
    const q = normalizeText(query.trim());
    const list = services.filter(
      (s) =>
        (showHidden || s.is_active) &&
        (!onlyMissing || s.technician_fee === 0) &&
        (!tierFilter || s.menu_tier === tierFilter) &&
        (!q || normalizeText(`${s.name} ${s.name_en ?? ""}`).includes(q)),
    );
    const g = categories.map((c) => ({ id: c.id, name: c.name, items: list.filter((s) => s.category_id === c.id) }));
    const none = list.filter((s) => !s.category_id || !categories.some((c) => c.id === s.category_id));
    if (none.length) g.push({ id: "none", name: "Chưa có nhóm", items: none });
    return g.filter((x) => x.items.length);
  }, [services, categories, query, showHidden, onlyMissing, tierFilter]);

  async function saveAll() {
    setMsg(null);
    for (const c of changes) {
      if (c.patch.name !== undefined && !c.patch.name.trim()) return setMsg({ ok: false, text: `Tên dịch vụ không được để trống.` });
      if (c.patch.duration_minutes !== undefined && !(c.patch.duration_minutes > 0))
        return setMsg({ ok: false, text: `${c.name}: thời lượng phải lớn hơn 0.` });
    }
    setSaving(true);
    const supabase = createClient();
    const failed: string[] = [];
    for (const c of changes) {
      const { error } = await supabase.from("services").update(c.patch).eq("id", c.id);
      if (error) failed.push(`${c.name}: ${vnError(error.message)}`);
    }
    setSaving(false);
    if (failed.length) {
      setMsg({ ok: false, text: `Lỗi khi lưu ${failed.length} dịch vụ. ${failed[0]}` });
    } else {
      setMsg({ ok: true, text: `Đã lưu ${changes.length} dịch vụ.` });
      setDrafts({});
    }
    router.refresh();
  }

  const missingFee = services.filter((s) => s.is_active && s.technician_fee === 0).length;

  return (
    <div className="space-y-3 pb-28">
      <div className="card space-y-3 p-3">
        <input className="input" placeholder="Tìm dịch vụ…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
            Chỉ dịch vụ chưa có tiền KTV ({missingFee})
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
            Hiện dịch vụ đã ngừng
          </label>
          <select
            className="rounded-lg border border-beige-dark bg-white px-2 py-1.5"
            value={tierFilter}
            onChange={(e) => setTierFilter(e.target.value as "" | "public" | "members")}
          >
            <option value="">Mọi cấp menu</option>
            <option value="public">Khách mới thấy</option>
            <option value="members">Chỉ khách đã mua gói</option>
          </select>
          <button className="btn-outline ml-auto py-2" onClick={() => setAdding((v) => !v)}>
            {adding ? "Đóng" : "+ Thêm dịch vụ"}
          </button>
        </div>
      </div>

      {adding && <NewServiceForm categories={categories} onDone={() => { setAdding(false); router.refresh(); }} />}

      {groups.length === 0 && <p className="card text-sm text-ink/60">Không có dịch vụ phù hợp.</p>}

      {groups.map((g) => (
        <section key={g.id} className="card p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-t-2xl bg-cream px-4 py-2.5">
            <h2 className="text-sm font-semibold text-navy">
              {g.name} <span className="font-normal text-ink/50">({g.items.length})</span>
            </h2>
            <span className="flex gap-1 text-[11px]">
              <span className="self-center text-ink/50">Cả nhóm:</span>
              <button type="button" className="rounded-full bg-white px-2 py-1 font-semibold text-[#22612A] ring-1 ring-beige-dark" onClick={() => g.items.forEach((s) => edit(s.id, { menu_tier: "public" }))}>
                khách mới thấy
              </button>
              <button type="button" className="rounded-full bg-white px-2 py-1 font-semibold text-navy ring-1 ring-beige-dark" onClick={() => g.items.forEach((s) => edit(s.id, { menu_tier: "members" }))}>
                chỉ khách có gói
              </button>
            </span>
          </div>
          <div className="hidden grid-cols-[1fr_5.5rem_7.5rem_7rem] gap-2 px-4 pt-2 text-[11px] uppercase tracking-wide text-ink/50 sm:grid">
            <span>Dịch vụ</span>
            <span>Phút</span>
            <span>Giá (đ)</span>
            <span>Tiền KTV (đ)</span>
          </div>
          <ul className="divide-y divide-beige">
            {g.items.map((s) => {
              const open = openId === s.id;
              const changed = changedIds.has(s.id);
              return (
                <li key={s.id} className={`px-4 py-3 ${changed ? "bg-[#FFE8BA]/30" : ""} ${val(s, "is_active") ? "" : "opacity-60"}`}>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-[1fr_5.5rem_7.5rem_7rem] sm:items-center">
                    <button
                      type="button"
                      className="col-span-3 text-left text-sm font-medium sm:col-span-1"
                      onClick={() => setOpenId(open ? null : s.id)}
                    >
                      {val(s, "name")}
                      {!val(s, "is_active") && <span className="ml-1 text-xs text-[#8A2323]">(ngừng)</span>}
                      <span className="ml-1 text-xs text-navy/60">{open ? "▴" : "▾ chi tiết"}</span>
                    </button>
                    <NumField
                      label="Phút"
                      value={String(val(s, "duration_minutes") ?? "")}
                      onChange={(v) => edit(s.id, { duration_minutes: Number(v.replace(/\D/g, "")) || 0 })}
                    />
                    <NumField
                      label="Giá"
                      value={moneyInput(val(s, "price"))}
                      placeholder="Báo giá"
                      onChange={(v) => edit(s.id, { price: parseMoney(v) })}
                    />
                    <NumField
                      label="Tiền KTV"
                      value={moneyInput(val(s, "technician_fee"))}
                      placeholder="0"
                      onChange={(v) => edit(s.id, { technician_fee: parseMoney(v) ?? 0 })}
                    />
                  </div>

                  <button
                    type="button"
                    title="Bấm để đổi: khách mới thấy / chỉ khách đã mua gói"
                    onClick={() => edit(s.id, { menu_tier: val(s, "menu_tier") === "public" ? "members" : "public" })}
                    className={`mt-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      val(s, "menu_tier") === "public" ? "bg-[#D6EDD8] text-[#22612A]" : "bg-[#DCE3F5] text-navy"
                    }`}
                  >
                    {val(s, "menu_tier") === "public" ? "👁 Khách mới thấy" : "🔒 Chỉ khách đã mua gói"}
                  </button>
                  {open && (
                    <div className="mt-3 grid gap-3 rounded-xl bg-cream p-3 sm:grid-cols-2">
                      <label className="text-sm">
                        <span className="label">Tên dịch vụ</span>
                        <input className="input py-2" value={val(s, "name")} onChange={(e) => edit(s.id, { name: e.target.value })} />
                      </label>
                      <label className="text-sm">
                        <span className="label">Tên tiếng Anh</span>
                        <input className="input py-2" value={val(s, "name_en") ?? ""} onChange={(e) => edit(s.id, { name_en: e.target.value || null })} />
                      </label>
                      <label className="text-sm">
                        <span className="label">Nhóm</span>
                        <select className="input py-2" value={val(s, "category_id") ?? ""} onChange={(e) => edit(s.id, { category_id: e.target.value || null })}>
                          <option value="">— Chưa có nhóm —</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </label>
                      <label className="text-sm">
                        <span className="label">Giá thành viên (đ)</span>
                        <input
                          className="input py-2"
                          inputMode="numeric"
                          placeholder="Không có"
                          value={moneyInput(val(s, "member_price"))}
                          onChange={(e) => edit(s.id, { member_price: parseMoney(e.target.value) })}
                        />
                      </label>
                      <label className="text-sm">
                        <span className="label">Chi nhánh</span>
                        <select className="input py-2" value={val(s, "branch_id") ?? ""} onChange={(e) => edit(s.id, { branch_id: e.target.value || null })}>
                          <option value="">Mọi chi nhánh</option>
                          {branches.map((b) => (
                            <option key={b.id} value={b.id}>Chỉ {b.name}</option>
                          ))}
                        </select>
                      </label>
                      <label className="text-sm">
                        <span className="label">Hỏi thăm khách sau khi làm (ngày)</span>
                        <input
                          className="input py-2"
                          inputMode="numeric"
                          placeholder="Không nhắc"
                          value={val(s, "followup_days") ?? ""}
                          onChange={(e) => edit(s.id, { followup_days: e.target.value.replace(/\D/g, "") === "" ? null : Math.min(60, Number(e.target.value.replace(/\D/g, ""))) })}
                        />
                      </label>
                      <label className="text-sm">
                        <span className="label">Mời khách quay lại sau (ngày)</span>
                        <input
                          className="input py-2"
                          inputMode="numeric"
                          placeholder="Không nhắc"
                          value={val(s, "recall_days") ?? ""}
                          onChange={(e) => edit(s.id, { recall_days: e.target.value.replace(/\D/g, "") === "" ? null : Math.min(730, Math.max(1, Number(e.target.value.replace(/\D/g, "")))) })}
                        />
                      </label>
                      <div className="space-y-2 text-sm">
                        <label className="flex items-center gap-2">
                          <input type="checkbox" checked={val(s, "card_allowed")} onChange={(e) => edit(s.id, { card_allowed: e.target.checked })} />
                          Cho trả bằng thẻ tài khoản
                        </label>
                        <label className="flex items-center gap-2">
                          <input type="checkbox" checked={val(s, "commission_eligible")} onChange={(e) => edit(s.id, { commission_eligible: e.target.checked })} />
                          Tính doanh số hoa hồng
                        </label>
                        <label className="flex items-center gap-2">
                          <input type="checkbox" checked={!!val(s, "fee_once_per_visit")} onChange={(e) => edit(s.id, { fee_once_per_visit: e.target.checked })} />
                          Tiền dịch vụ KTV chỉ tính 1 lần / lượt khách (vd Meso chấm nốt mụn nhiều điểm)
                        </label>
                        <label className="flex items-center gap-2">
                          <input type="checkbox" checked={!val(s, "is_active")} onChange={(e) => edit(s.id, { is_active: !e.target.checked })} />
                          Ngừng dịch vụ (ẩn khỏi đặt lịch)
                        </label>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-beige-dark bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <div className="flex-1 text-sm">
            {changes.length === 0 ? (
              <span className="text-ink/60">Chưa có thay đổi</span>
            ) : (
              <b className="text-navy">{changes.length} dịch vụ đã sửa, chưa lưu</b>
            )}
            {msg && <p className={`text-xs font-medium ${msg.ok ? "text-[#22612A]" : "text-[#8A2323]"}`}>{msg.text}</p>}
          </div>
          {changes.length > 0 && (
            <button className="btn-ghost" disabled={saving} onClick={() => setDrafts({})}>Bỏ thay đổi</button>
          )}
          <button className="btn-primary px-6 py-3" disabled={saving || changes.length === 0} onClick={saveAll}>
            {saving ? "Đang lưu…" : "Lưu"}
          </button>
        </div>
      </div>
    </div>
  );
}

function NumField({ label, value, placeholder, onChange }: { label: string; value: string; placeholder?: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] text-ink/50 sm:hidden">{label}</span>
      <input
        className="w-full rounded-lg border border-beige-dark bg-white px-2 py-1.5 text-right text-sm outline-none focus:border-navy"
        inputMode="numeric"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function NewServiceForm({ categories, onDone }: { categories: Category[]; onDone: () => void }) {
  const [name, setName] = useState("");
  const [cat, setCat] = useState(categories[0]?.id ?? "");
  const [dur, setDur] = useState("60");
  const [price, setPrice] = useState("");
  const [fee, setFee] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (!name.trim()) return setError("Vui lòng nhập tên dịch vụ.");
    const d = Number(dur);
    if (!(d > 0)) return setError("Thời lượng phải lớn hơn 0.");
    setSaving(true);
    const { error } = await createClient().from("services").insert({
      name: name.trim(),
      category_id: cat || null,
      duration_minutes: d,
      price: parseMoney(price),
      technician_fee: parseMoney(fee) ?? 0,
    });
    setSaving(false);
    if (error) return setError(vnError(error.message));
    onDone();
  }

  return (
    <div className="card space-y-3">
      <h2 className="font-semibold text-navy">Thêm dịch vụ mới</h2>
      <input className="input" placeholder="Tên dịch vụ" value={name} onChange={(e) => setName(e.target.value)} />
      <select className="input" value={cat} onChange={(e) => setCat(e.target.value)}>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      <div className="grid grid-cols-3 gap-2">
        <label className="text-sm"><span className="label">Phút</span><input className="input py-2" inputMode="numeric" value={dur} onChange={(e) => setDur(e.target.value.replace(/\D/g, ""))} /></label>
        <label className="text-sm"><span className="label">Giá (đ)</span><input className="input py-2" inputMode="numeric" placeholder="Báo giá" value={price} onChange={(e) => setPrice(moneyInput(parseMoney(e.target.value)))} /></label>
        <label className="text-sm"><span className="label">Tiền KTV (đ)</span><input className="input py-2" inputMode="numeric" placeholder="0" value={fee} onChange={(e) => setFee(moneyInput(parseMoney(e.target.value)))} /></label>
      </div>
      {error && <p className="text-sm text-[#8A2323]">{error}</p>}
      <p className="text-xs text-ink/50">Giá hiển thị cho khách: {formatVnd(parseMoney(price))}</p>
      <button className="btn-primary" disabled={saving} onClick={save}>{saving ? "Đang lưu…" : "Thêm"}</button>
    </div>
  );
}
