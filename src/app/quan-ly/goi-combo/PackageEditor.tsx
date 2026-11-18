"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatVnd, normalizeText, textMatch, vnError } from "@/lib/format";
import MoneyInput from "@/components/MoneyInput";

export type Pkg = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  validity_days: number | null;
  is_active: boolean;
  category: string | null;
  sort_order: number;
  menu_tier: "public" | "private";
  approval_status: "approved" | "pending" | "rejected";
  approval_reason: string | null;
  review_note: string | null;
  package_items: {
    id: string;
    label: string;
    note?: string | null;
    quantity: number | null;
    unit_price: number | null;
    sort_order: number;
    package_item_services: { service_id: string }[];
  }[];
};
type Svc = { id: string; name: string; name_en: string | null; price: number | null; category_id: string | null };
type Cat = { id: string; name: string };
type Part = { key: number; label: string; note: string; unlimited: boolean; quantity: number; unit_price: number; service_ids: string[] };
type Draft = {
  id: string | null;
  name: string;
  description: string;
  price: number;
  validity: string;
  category: string;
  is_active: boolean;
  menu_tier: "public" | "private";
  parts: Part[];
};

let seq = 1;
const newPart = (): Part => ({ key: seq++, label: "", note: "", unlimited: false, quantity: 1, unit_price: 0, service_ids: [] });

function ServicePicker({ services, onPick, exclude }: { services: Svc[]; onPick: (s: Svc) => void; exclude: string[] }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = normalizeText(query.trim());
    if (!q) return [];
    return services.filter((s) => !exclude.includes(s.id) && textMatch(`${s.name} ${s.name_en ?? ""}`, q)).slice(0, 8);
  }, [query, services, exclude]);
  return (
    <div>
      <input className="input mt-1 py-1.5 text-sm" placeholder="+ Thêm dịch vụ được dùng (gõ tên)" value={query} onChange={(e) => setQuery(e.target.value)} />
      {filtered.length > 0 && (
        <ul className="mt-1 divide-y divide-beige rounded-xl border border-beige-dark bg-white">
          {filtered.map((s) => (
            <li key={s.id}>
              <button
                className="flex w-full justify-between px-3 py-1.5 text-left text-sm hover:bg-cream"
                onClick={() => {
                  onPick(s);
                  setQuery("");
                }}
              >
                <span>
                  <span className="font-medium uppercase">{s.name_en || s.name}</span> <span className="text-xs text-ink/50">{s.name_en ? s.name : ""}</span>
                </span>
                <span className="text-ink/60">{formatVnd(s.price)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GroupPicker({ categories, services, onPick }: { categories: Cat[]; services: Svc[]; onPick: (ids: string[], minPrice: number) => void }) {
  const [cat, setCat] = useState("");
  const [maxPrice, setMaxPrice] = useState(0);
  const inGroup = services.filter((s) => s.category_id === cat && (!maxPrice || Number(s.price ?? 0) <= maxPrice));
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
      <select className="rounded-lg border border-beige-dark bg-white px-2 py-1.5" value={cat} onChange={(e) => setCat(e.target.value)}>
        <option value="">+ Chọn cả nhóm liệu trình…</option>
        {categories
          .filter((c) => services.some((s) => s.category_id === c.id))
          .map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({services.filter((s) => s.category_id === c.id).length})
            </option>
          ))}
      </select>
      {cat && (
        <>
          <label className="flex items-center gap-1">
            giá lẻ tối đa
            <MoneyInput value={maxPrice} onChange={setMaxPrice} className="w-24" ariaLabel="Giá lẻ tối đa trong nhóm" />
          </label>
          <button
            type="button"
            className="btn-ghost px-2 py-1 text-xs"
            disabled={inGroup.length === 0}
            onClick={() => {
              onPick(inGroup.map((s) => s.id), Math.min(...inGroup.map((s) => Number(s.price ?? 0))));
              setCat("");
              setMaxPrice(0);
            }}
          >
            Thêm {inGroup.length} liệu trình
          </button>
        </>
      )}
    </div>
  );
}

export default function PackageEditor({ packages, services, categories, isOwner }: { packages: Pkg[]; services: Svc[]; categories: Cat[]; isOwner: boolean }) {
  const router = useRouter();
  const byId = useMemo(() => new Map(services.map((s) => [s.id, s])), [services]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Chỉ chủ: cost từng liệu trình (máy chủ trả rỗng với tài khoản khác)
  const [svcCost, setSvcCost] = useState<Map<string, { cost: number; missing: number }>>(new Map());
  const draftIds = draft ? Array.from(new Set(draft.parts.flatMap((p) => p.service_ids))).sort().join(",") : "";
  useEffect(() => {
    if (!isOwner || !draftIds) return;
    const ids = draftIds.split(",").filter((id) => !svcCost.has(id));
    if (ids.length === 0) return;
    createClient()
      .rpc("service_costs", { p_ids: ids })
      .then(({ data }) => {
        if (!data) return;
        setSvcCost((m) => {
          const n = new Map(m);
          for (const r of data as { service_id: string; cost: number; missing: number }[]) n.set(r.service_id, { cost: Number(r.cost), missing: r.missing });
          return n;
        });
      });
  }, [isOwner, draftIds, svcCost]);

  function edit(p: Pkg) {
    setError(null);
    setNotice(null);
    setDraft({
      id: p.id,
      name: p.name,
      description: p.description ?? "",
      price: Number(p.price),
      validity: p.validity_days ? String(p.validity_days) : "",
      category: p.category ?? "",
      is_active: p.approval_status === "approved" ? p.is_active : true,
      menu_tier: p.menu_tier,
      parts: [...p.package_items]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((i) => ({
          key: seq++,
          label: i.label,
          note: i.note ?? "",
          unlimited: i.quantity === null,
          quantity: i.quantity ?? 1,
          unit_price: Number(i.unit_price ?? 0),
          service_ids: i.package_item_services.map((x) => x.service_id),
        })),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setPart(key: number, patch: Partial<Part>) {
    if (!draft) return;
    setDraft({ ...draft, parts: draft.parts.map((p) => (p.key === key ? { ...p, ...patch } : p)) });
  }

  async function save() {
    if (!draft) return;
    if (isOwner && costInfo.ready && costInfo.cost > draft.price && draft.price > 0) {
      if (!window.confirm(`Cost liệu trình (${formatVnd(costInfo.cost)}) đang CAO HƠN giá bán (${formatVnd(draft.price)}). Vẫn lưu combo này?`)) return;
    }
    if (draft.price <= 0) return setError("Vui lòng nhập giá bán combo");
    setSaving(true);
    setError(null);
    setNotice(null);
    const supabase = createClient();
    const { data: savedId, error } = await supabase.rpc("save_package", {
      p_id: draft.id,
      p_name: draft.name,
      p_price: draft.price,
      p_validity_days: draft.validity ? Number(draft.validity) : null,
      p_description: draft.description,
      p_is_active: draft.is_active,
      p_category: draft.category,
      p_items: draft.parts.map((p) => ({
        label: p.label || (p.service_ids.length === 1 ? byId.get(p.service_ids[0])?.name_en || byId.get(p.service_ids[0])?.name || "" : ""),
        note: p.note,
        quantity: p.unlimited ? null : p.quantity,
        unit_price: p.unit_price || null,
        service_ids: p.service_ids,
      })),
    });
    if (error) {
      setSaving(false);
      return setError(vnError(error.message));
    }
    const pid = (savedId as string) ?? draft.id;
    const { error: tierError } = await supabase.from("packages").update({ menu_tier: draft.menu_tier }).eq("id", pid);
    const { data: st } = await supabase.from("packages").select("approval_status, approval_reason").eq("id", pid).maybeSingle();
    setSaving(false);
    if (tierError) return setError(vnError(tierError.message));
    setDraft(null);
    if (st?.approval_status === "pending") {
      setNotice(`⚠ Combo “${draft.name}” chưa được bán: ${st.approval_reason ?? "cần chủ kiểm tra"}. Đã gửi chủ spa duyệt.`);
    }
    router.refresh();
  }

  const retail = draft ? draft.parts.reduce((a, p) => a + (p.unlimited ? 0 : p.unit_price * p.quantity), 0) : 0;
  const partCost = (p: Part) => (p.service_ids.length ? Math.max(...p.service_ids.map((id) => svcCost.get(id)?.cost ?? 0)) : 0);
  const costInfo = useMemo(() => {
    if (!draft || !isOwner) return { ready: false, cost: 0, missing: 0, unlimited: false };
    const ids = draft.parts.flatMap((p) => p.service_ids);
    return {
      ready: ids.length > 0 && ids.every((id) => svcCost.has(id)),
      cost: draft.parts.reduce((a, p) => a + (p.unlimited ? 0 : p.quantity * partCost(p)), 0),
      missing: ids.reduce((a, id) => a + (svcCost.get(id)?.missing ?? 0), 0),
      unlimited: draft.parts.some((p) => p.unlimited),
    };
  }, [draft, isOwner, svcCost]);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-navy">Gói combo</h1>
          <p className="text-sm text-ink/70">{packages.filter((p) => p.is_active).length} gói đang bán. Bấm vào gói để sửa.</p>
        </div>
        {!draft && (
          <button className="btn-primary" onClick={() => { setError(null); setNotice(null); setDraft({ id: null, name: "", description: "", price: 0, validity: "", category: "", is_active: true, menu_tier: "private", parts: [newPart()] }); }}>
            + Tạo gói
          </button>
        )}
      </div>

      {notice && <p className="card border-[#E8B4B4] bg-[#FDECEC] text-sm font-medium text-[#8A2323]">{notice}</p>}

      {draft && (
        <div className="card space-y-3">
          <h2 className="font-semibold text-navy">{draft.id ? "Sửa gói" : "Gói mới"}</h2>
          <label className="block">
            <span className="label">Tên gói</span>
            <input className="input py-2" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="label">Giá bán combo</span>
              <MoneyInput value={draft.price} onChange={(n) => setDraft({ ...draft, price: n })} className="w-full py-2.5 text-base" ariaLabel="Giá gói" />
            </label>
            <label className="block">
              <span className="label">Hạn dùng (ngày)</span>
              <input type="number" min={1} className="input py-2" placeholder="bỏ trống = không hạn" value={draft.validity} onChange={(e) => setDraft({ ...draft, validity: e.target.value })} />
            </label>
          </div>
          <label className="block">
            <span className="label">Nhóm combo (trên Menu Combo)</span>
            <input className="input py-2" list="combo-groups" placeholder="vd: Mụn – Lỗ chân lông" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} />
            <datalist id="combo-groups">
              {Array.from(new Set(packages.map((p) => p.category ?? "").filter((c) => c !== ""))).map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label className="block">
            <span className="label">Mục tiêu / mô tả</span>
            <input className="input py-2" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </label>

          <div className="space-y-2">
            <span className="label">Liệu trình trong gói</span>
            {draft.parts.map((p, i) => (
              <div key={p.key} className="rounded-xl border border-beige-dark p-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-ink/50">{i + 1}.</span>
                  <input
                    className="flex-1 rounded-lg border border-beige-dark px-2 py-1.5"
                    placeholder="Tên buổi truyền thông – khách thấy (vd: Acne Peeling)"
                    value={p.label}
                    onChange={(e) => setPart(p.key, { label: e.target.value })}
                  />
                  <button className="px-1 text-ink/40 hover:text-[#8A2323]" onClick={() => setDraft({ ...draft, parts: draft.parts.filter((x) => x.key !== p.key) })}>
                    ✕
                  </button>
                </div>
                <input
                  className="mt-2 w-full rounded-lg border border-beige-dark bg-cream px-2 py-1.5 text-xs"
                  placeholder="🔒 Thực tế chỉ định – chỉ nhân viên thấy (vd: Được chọn peel bất kì trong nhóm Chemical Peel)"
                  value={p.note}
                  onChange={(e) => setPart(p.key, { note: e.target.value })}
                />
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                  <label className="flex items-center gap-1">
                    Số buổi
                    <input
                      type="number"
                      min={1}
                      disabled={p.unlimited}
                      className="w-16 rounded-lg border border-beige-dark px-2 py-1 text-right disabled:bg-cream"
                      value={p.unlimited ? "" : p.quantity}
                      onChange={(e) => setPart(p.key, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                    />
                  </label>
                  <label className="flex items-center gap-1">
                    <input type="checkbox" checked={p.unlimited} onChange={(e) => setPart(p.key, { unlimited: e.target.checked })} />
                    Không giới hạn
                  </label>
                  <label className="flex items-center gap-1">
                    Giá lẻ / buổi
                    <MoneyInput value={p.unit_price} onChange={(n) => setPart(p.key, { unit_price: n })} className="w-28" ariaLabel="Giá lẻ mỗi buổi" />
                  </label>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {p.service_ids.map((id) => (
                    <span key={id} className="inline-flex items-center gap-1 rounded-full bg-cream px-2 py-0.5 text-xs">
                      {byId.get(id) ? byId.get(id)!.name_en || byId.get(id)!.name : "(dịch vụ đã ngừng)"}
                      <button className="text-ink/40 hover:text-[#8A2323]" onClick={() => setPart(p.key, { service_ids: p.service_ids.filter((x) => x !== id) })}>
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
                {p.service_ids.length > 1 && <p className="mt-1 text-xs text-ink/60">KTV chọn 1 trong các dịch vụ trên cho mỗi buổi, trừ chung vào số buổi của phần này.</p>}
                {isOwner && p.service_ids.length > 0 && svcCost.size > 0 && (
                  <p className="mt-1 text-[11px] text-[#7A5A12]">
                    🔒 Cost {p.service_ids.length > 1 ? "cao nhất " : ""}{formatVnd(partCost(p))} / buổi
                    {!p.unlimited && ` · ${formatVnd(partCost(p) * p.quantity)} cho ${p.quantity} buổi`}
                  </p>
                )}
                <GroupPicker
                  categories={categories}
                  services={services}
                  onPick={(ids, minPrice) =>
                    setPart(p.key, {
                      service_ids: Array.from(new Set([...p.service_ids, ...ids])),
                      unit_price: p.unit_price || minPrice,
                    })
                  }
                />
                <ServicePicker
                  services={services}
                  exclude={p.service_ids}
                  onPick={(s) =>
                    setPart(p.key, {
                      service_ids: [...p.service_ids, s.id],
                      unit_price: p.unit_price || Number(s.price ?? 0),
                    })
                  }
                />
              </div>
            ))}
            <button className="btn-ghost py-1.5 text-xs" onClick={() => setDraft({ ...draft, parts: [...draft.parts, newPart()] })}>
              + Thêm liệu trình
            </button>
            {retail > 0 && (
              <div className="rounded-xl bg-cream px-3 py-2 text-sm">
                <p className="flex justify-between">
                  <span>Tổng giá lẻ các buổi</span> <b>{formatVnd(retail)}</b>
                </p>
                <p className="flex justify-between">
                  <span>Giá bán combo</span>
                  <b className="text-navy">
                    {draft.price > 0 ? formatVnd(draft.price) : "chưa nhập"}
                    {draft.price > 0 && draft.price < retail && ` (giảm ${Math.round((1 - draft.price / retail) * 100)}%)`}
                  </b>
                </p>
                {isOwner && costInfo.ready && (
                  <>
                    <p className={`flex justify-between ${draft.price > 0 && costInfo.cost > draft.price ? "font-semibold text-[#8A2323]" : "text-[#7A5A12]"}`}>
                      <span>🔒 Cost liệu trình (chỉ chủ thấy)</span>
                      <b>
                        {formatVnd(costInfo.cost)}
                        {draft.price > 0 && ` · ${Math.round((costInfo.cost / draft.price) * 100)}% giá bán`}
                      </b>
                    </p>
                    {draft.price > 0 && costInfo.cost > draft.price && <p className="text-xs font-semibold text-[#8A2323]">⚠ Cost cao hơn giá bán – combo đang lỗ.</p>}
                    {(costInfo.missing > 0 || costInfo.unlimited) && (
                      <p className="text-xs text-ink/60">
                        {costInfo.missing > 0 && `${costInfo.missing} sản phẩm chưa có giá nhập (chưa tính). `}
                        {costInfo.unlimited && "Phần không giới hạn buổi chưa tính vào cost."}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.is_active} onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })} />
            Đang bán
          </label>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="label mb-0">Hiển thị trên app</span>
            <button
              type="button"
              className={`rounded-full px-3 py-1 text-xs font-semibold ${draft.menu_tier === "public" ? "bg-[#D6EDD8] text-[#22612A]" : "bg-[#DCE3F5] text-navy"}`}
              onClick={() => setDraft({ ...draft, menu_tier: draft.menu_tier === "public" ? "private" : "public" })}
            >
              {draft.menu_tier === "public" ? "👁 Public – khách có tài khoản thấy" : "🔒 Private – chỉ nhân viên thấy"}
            </button>
          </div>
          <p className="text-xs text-ink/50">
            {!isOwner && "Hệ thống tự kiểm tra chi phí liệu trình: nếu giá bán thấp hơn chi phí, combo sẽ chưa được bán và chuyển chủ spa duyệt. "}
            Giá lẻ / buổi dùng để tính tiền hoàn khi khách huỷ gói (giá gói − số buổi đã dùng × giá lẻ). Sửa gói không ảnh hưởng gói khách đã mua.
          </p>
          {error && <p className="text-sm text-[#8A2323]">{error}</p>}
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setDraft(null)}>Thôi</button>
            <button className="btn-primary" disabled={saving} onClick={save}>{saving ? "Đang lưu…" : "Lưu gói"}</button>
          </div>
        </div>
      )}

      {packages.length === 0 && !draft && <p className="card text-sm text-ink/60">Chưa có gói combo nào. Bấm “+ Tạo gói”.</p>}
      <div className="space-y-2">
        {packages.map((p) => (
          <button key={p.id} className={`card block w-full p-4 text-left hover:border-navy ${p.is_active ? "" : "opacity-60"}`} onClick={() => edit(p)}>
            <div className="flex justify-between gap-3">
              <p className="font-semibold">
                {p.name} {!p.is_active && <span className="text-xs font-normal text-ink/60">(ngừng bán)</span>}
                {p.approval_status === "pending" && <span className="ml-1.5 rounded-full bg-[#FFE7C2] px-2 text-[10px] font-semibold text-[#8A4B0C]">⏳ Chờ chủ duyệt</span>}
                {p.approval_status === "rejected" && <span className="ml-1.5 rounded-full bg-[#FDECEC] px-2 text-[10px] font-semibold text-[#8A2323]">✕ Chủ từ chối</span>}
                <span className={`ml-1.5 rounded-full px-2 text-[10px] font-normal ${p.menu_tier === "public" ? "bg-[#D6EDD8] text-[#22612A]" : "bg-[#DCE3F5] text-navy"}`}>
                  {p.menu_tier === "public" ? "👁 Public" : "🔒 Private"}
                </span>
              </p>
              <p className="shrink-0 font-bold text-navy">{formatVnd(Number(p.price))}</p>
            </div>
            {(p.category || p.description) && <p className="text-xs text-ink/60">{[p.category, p.description].filter(Boolean).join(" · ")}</p>}
            <p className="mt-1 text-xs text-ink/70">
              {[...p.package_items]
                .sort((a, b) => a.sort_order - b.sort_order)
                .map((i) => `${i.label} ${i.quantity === null ? "(không giới hạn)" : `×${i.quantity}`}`)
                .join(" · ")}
              {p.validity_days ? ` · hạn ${p.validity_days} ngày` : ""}
            </p>
            {p.approval_status === "pending" && p.approval_reason && <p className="mt-1 text-xs text-[#8A4B0C]">Lý do chờ duyệt: {p.approval_reason}</p>}
            {p.approval_status === "rejected" && <p className="mt-1 text-xs text-[#8A2323]">Chủ từ chối{p.review_note ? `: ${p.review_note}` : ""} – sửa lại rồi lưu để gửi duyệt lại.</p>}
          </button>
        ))}
      </div>
    </div>
  );
}
