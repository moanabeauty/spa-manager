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
  package_services: { service_id: string; quantity: number }[];
};
type Svc = { id: string; name: string; name_en: string | null; price: number | null };
type Draft = {
  id: string | null;
  name: string;
  description: string;
  price: number;
  validity: string;
  is_active: boolean;
  items: { service_id: string; quantity: number }[];
};

const empty: Draft = { id: null, name: "", description: "", price: 0, validity: "", is_active: true, items: [] };

export default function PackageEditor({ packages, services }: { packages: Pkg[]; services: Svc[] }) {
  const router = useRouter();
  const byId = useMemo(() => new Map(services.map((s) => [s.id, s])), [services]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = normalizeText(query.trim());
    if (!q) return [];
    return services.filter((s) => normalizeText(`${s.name} ${s.name_en ?? ""}`).includes(q)).slice(0, 10);
  }, [query, services]);

  function edit(p: Pkg) {
    setError(null);
    setDraft({
      id: p.id,
      name: p.name,
      description: p.description ?? "",
      price: Number(p.price),
      validity: p.validity_days ? String(p.validity_days) : "",
      is_active: p.is_active,
      items: p.package_services.map((x) => ({ ...x })),
    });
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    const { error } = await createClient().rpc("save_package", {
      p_id: draft.id,
      p_name: draft.name,
      p_price: draft.price,
      p_validity_days: draft.validity ? Number(draft.validity) : null,
      p_description: draft.description,
      p_is_active: draft.is_active,
      p_services: draft.items,
    });
    setSaving(false);
    if (error) return setError(vnError(error.message));
    setDraft(null);
    router.refresh();
  }

  const retail = draft ? draft.items.reduce((a, i) => a + Number(byId.get(i.service_id)?.price ?? 0) * i.quantity, 0) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-navy">Gói combo</h1>
          <p className="text-sm text-ink/70">Gói khách mua ở quầy; mỗi lần làm sẽ trừ buổi khi thu tiền.</p>
        </div>
        {!draft && (
          <button className="btn-primary" onClick={() => { setError(null); setDraft({ ...empty }); }}>
            + Tạo gói
          </button>
        )}
      </div>

      {draft && (
        <div className="card space-y-3">
          <h2 className="font-semibold text-navy">{draft.id ? "Sửa gói" : "Gói mới"}</h2>
          <label className="block">
            <span className="label">Tên gói</span>
            <input className="input py-2" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="VD: Combo 10 buổi chăm sóc da" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="label">Giá bán</span>
              <MoneyInput value={draft.price} onChange={(n) => setDraft({ ...draft, price: n })} className="w-full py-2.5 text-base" ariaLabel="Giá gói" />
            </label>
            <label className="block">
              <span className="label">Hạn dùng (ngày)</span>
              <input
                type="number"
                min={1}
                className="input py-2"
                placeholder="bỏ trống = không hạn"
                value={draft.validity}
                onChange={(e) => setDraft({ ...draft, validity: e.target.value })}
              />
            </label>
          </div>
          <label className="block">
            <span className="label">Mô tả (không bắt buộc)</span>
            <input className="input py-2" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </label>

          <div>
            <span className="label">Dịch vụ trong gói</span>
            {draft.items.length === 0 && <p className="text-sm text-ink/60">Chưa có dịch vụ nào.</p>}
            <ul className="space-y-1">
              {draft.items.map((it, i) => (
                <li key={it.service_id} className="flex items-center gap-2 text-sm">
                  <span className="flex-1">{byId.get(it.service_id)?.name ?? "(dịch vụ đã ngừng)"}</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    className="w-16 rounded-lg border border-beige-dark px-2 py-1 text-right"
                    value={it.quantity}
                    onChange={(e) =>
                      setDraft({ ...draft, items: draft.items.map((x, j) => (j === i ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) } : x)) })
                    }
                  />
                  <span className="text-xs text-ink/60">buổi</span>
                  <button className="px-1 text-ink/40 hover:text-[#8A2323]" onClick={() => setDraft({ ...draft, items: draft.items.filter((_, j) => j !== i) })}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
            <input className="input mt-2 py-2" placeholder="+ Thêm dịch vụ (gõ tên)" value={query} onChange={(e) => setQuery(e.target.value)} />
            {filtered.length > 0 && (
              <ul className="mt-1 divide-y divide-beige rounded-xl border border-beige-dark">
                {filtered.map((s) => (
                  <li key={s.id}>
                    <button
                      className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-cream disabled:opacity-40"
                      disabled={draft.items.some((x) => x.service_id === s.id)}
                      onClick={() => {
                        setDraft({ ...draft, items: [...draft.items, { service_id: s.id, quantity: 1 }] });
                        setQuery("");
                      }}
                    >
                      <span>{s.name}</span>
                      <span className="text-ink/60">{formatVnd(s.price)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {retail > 0 && (
              <p className="mt-2 text-xs text-ink/60">
                Nếu mua lẻ: {formatVnd(retail)}
                {draft.price > 0 && draft.price < retail && ` · khách tiết kiệm ${formatVnd(retail - draft.price)}`}
              </p>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.is_active} onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })} />
            Đang bán
          </label>
          <p className="text-xs text-ink/50">Sửa gói không ảnh hưởng gói khách đã mua trước đó.</p>
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
              </p>
              <p className="shrink-0 font-bold text-navy">{formatVnd(Number(p.price))}</p>
            </div>
            <p className="text-xs text-ink/60">
              {p.package_services.map((x) => `${byId.get(x.service_id)?.name ?? "?"} ×${x.quantity}`).join(", ")}
              {p.validity_days ? ` · hạn ${p.validity_days} ngày` : " · không giới hạn thời gian"}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
