"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatVnd, normalizeText, vnError } from "@/lib/format";
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
type Svc = { id: string; name: string; name_en: string | null; price: number | null };
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
    return services.filter((s) => !exclude.includes(s.id) && normalizeText(`${s.name} ${s.name_en ?? ""}`).includes(q)).slice(0, 8);
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

export default function PackageEditor({ packages, services }: { packages: Pkg[]; services: Svc[] }) {
  const router = useRouter();
  const byId = useMemo(() => new Map(services.map((s) => [s.id, s])), [services]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function edit(p: Pkg) {
    setError(null);
    setDraft({
      id: p.id,
      name: p.name,
      description: p.description ?? "",
      price: Number(p.price),
      validity: p.validity_days ? String(p.validity_days) : "",
      category: p.category ?? "",
      is_active: p.is_active,
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
    setSaving(true);
    setError(null);
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
    const { error: tierError } = await supabase
      .from("packages")
      .update({ menu_tier: draft.menu_tier })
      .eq("id", (savedId as string) ?? draft.id);
    setSaving(false);
    if (tierError) return setError(vnError(tierError.message));
    setDraft(null);
    router.refresh();
  }

  const retail = draft ? draft.parts.reduce((a, p) => a + (p.unlimited ? 0 : p.unit_price * p.quantity), 0) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-navy">Gói combo</h1>
          <p className="text-sm text-ink/70">{packages.filter((p) => p.is_active).length} gói đang bán. Bấm vào gói để sửa.</p>
        </div>
        {!draft && (
          <button className="btn-primary" onClick={() => { setError(null); setDraft({ id: null, name: "", description: "", price: 0, validity: "", category: "", is_active: true, menu_tier: "private", parts: [newPart()] }); }}>
            + Tạo gói
          </button>
        )}
      </div>

      {draft && (
        <div className="card space-y-3">
          <h2 className="font-semibold text-navy">{draft.id ? "Sửa gói" : "Gói mới"}</h2>
          <label className="block">
            <span className="label">Tên gói</span>
            <input className="input py-2" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="label">Giá combo</span>
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
              <p className="text-xs text-ink/60">
                Tổng giá lẻ: {formatVnd(retail)}
                {draft.price > 0 && draft.price < retail && ` · giảm ${Math.round((1 - draft.price / retail) * 100)}%`}
              </p>
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
          </button>
        ))}
      </div>
    </div>
  );
}
