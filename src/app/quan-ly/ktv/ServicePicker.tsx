"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { normalizeText } from "@/lib/format";

export type PickService = { id: string; name: string; name_en: string | null; duration_minutes: number; branch_id: string | null; category: string | null };
export type Pick = { serviceId: string; itemId: string | null; label: string; minutes: number };
type Combo = { item_id: string; package_name: string; label: string; left_qty: number | null; service_id: string };

/**
 * Chọn liệu trình: các liệu trình trong combo khách đang có (còn buổi) hiện TRƯỚC,
 * sau đó mới đến danh sách dịch vụ khách chưa có.
 */
export default function ServicePicker({
  customerId,
  branchId,
  services,
  value,
  onChange,
}: {
  customerId: string | null;
  branchId: string;
  services: PickService[];
  value: Pick | null;
  onChange: (p: Pick | null) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [combos, setCombos] = useState<Combo[]>([]);
  const [q, setQ] = useState("");
  const byId = useMemo(() => new Map(services.map((s) => [s.id, s])), [services]);

  useEffect(() => {
    if (!customerId) return setCombos([]);
    let off = false;
    supabase.rpc("customer_combo_services", { p_customer: customerId }).then(({ data }) => {
      if (!off) setCombos((data ?? []) as Combo[]);
    });
    return () => {
      off = true;
    };
  }, [customerId, supabase]);

  const local = services.filter((s) => s.branch_id === null || s.branch_id === branchId);
  const comboIds = new Set(combos.map((c) => c.service_id));
  const nq = normalizeText(q.trim());
  const match = (s: PickService) => !nq || normalizeText(`${s.name} ${s.name_en ?? ""}`).includes(nq);
  const others = local.filter((s) => !comboIds.has(s.id) && match(s));
  // gom combo theo phần (1 phần có thể dùng nhiều dịch vụ)
  const comboRows = combos.filter((c) => byId.has(c.service_id) && match(byId.get(c.service_id)!));

  const label = (s: PickService) => s.name_en || s.name;
  const choose = (s: PickService, itemId: string | null) =>
    onChange({ serviceId: s.id, itemId, label: label(s), minutes: s.duration_minutes });
  const isOn = (sid: string, item: string | null) => value?.serviceId === sid && (value?.itemId ?? null) === item;

  return (
    <div className="space-y-2">
      <input className="input py-2.5 text-[15px]" placeholder="Tìm liệu trình…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="max-h-72 space-y-1 overflow-y-auto rounded-xl bg-white p-1 ring-1 ring-beige-dark">
        {comboRows.length > 0 && <p className="px-2 pt-1 text-xs font-bold uppercase tracking-wide text-brown">Trong combo khách đang có</p>}
        {comboRows.map((c) => {
          const s = byId.get(c.service_id)!;
          const on = isOn(s.id, c.item_id);
          return (
            <button
              key={`${c.item_id}-${s.id}`}
              type="button"
              onClick={() => choose(s, c.item_id)}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm ${on ? "bg-navy text-white" : "hover:bg-cream"}`}
            >
              <span className="min-w-0">
                <span className="block font-semibold">{label(s)}</span>
                <span className={`block text-xs ${on ? "text-white/80" : "text-[#646464]"}`}>{c.package_name} · {c.label}</span>
              </span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${on ? "bg-white/20" : "bg-beige text-[#5E4B30]"}`}>
                {c.left_qty === null ? "không giới hạn" : `còn ${c.left_qty} buổi`}
              </span>
            </button>
          );
        })}
        {comboRows.length > 0 && <p className="px-2 pt-2 text-xs font-bold uppercase tracking-wide text-[#646464]">Dịch vụ khác</p>}
        {others.slice(0, nq ? 40 : 200).map((s) => {
          const on = isOn(s.id, null);
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => choose(s, null)}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm ${on ? "bg-navy text-white" : "hover:bg-cream"}`}
            >
              <span className="min-w-0">
                <span className="block font-medium">{label(s)}</span>
                <span className={`block text-xs ${on ? "text-white/80" : "text-[#646464]"}`}>{s.category ? `${s.category} · ` : ""}{s.duration_minutes} phút</span>
              </span>
            </button>
          );
        })}
        {comboRows.length === 0 && others.length === 0 && <p className="px-3 py-2 text-sm text-[#646464]">Không tìm thấy liệu trình.</p>}
      </div>
    </div>
  );
}
