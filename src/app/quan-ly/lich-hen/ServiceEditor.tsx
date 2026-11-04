"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatDuration, formatVnd, normalizeText, vnError } from "@/lib/format";
import { techLabel, type Technician } from "@/lib/staff";
import { bestPart, fetchPackageOptions, partLeft, partLeftText, partName, shortDmy, usageOf, type PackageOption } from "@/lib/packageBooking";

export type EditorService = { id: string; name: string; name_en: string | null; price: number | null; duration_minutes: number; branch_id: string | null };
type Row = { key: number; serviceId: string; technicianId: string; partId: string | null; staffChoose: boolean };

/**
 * Quản lý / chủ spa đổi dịch vụ trên lịch: khách đặt A, KTV tư vấn xong khách làm B.
 * Giữ được KTV, gắn / bỏ trừ buổi gói; lưu kèm lý do để xem lại lịch sử.
 */
export default function ServiceEditor({
  appointmentId,
  customerId,
  branchId,
  current,
  services,
  technicians,
  branches,
  consult,
}: {
  appointmentId: string;
  customerId: string;
  branchId: string;
  current: { serviceId: string; technicianId: string | null; partId: string | null; staffChoose: boolean }[];
  services: EditorService[];
  technicians: Technician[];
  branches: { id: string; name: string }[];
  consult: boolean;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [nextKey, setNextKey] = useState(1);
  const [parts, setParts] = useState<PackageOption[]>([]);
  const [q, setQ] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const byId = useMemo(() => new Map(services.map((s) => [s.id, s])), [services]);

  useEffect(() => {
    if (!open) return;
    setRows(current.map((c, i) => ({ key: i + 1, serviceId: c.serviceId, technicianId: c.technicianId ?? "", partId: c.partId, staffChoose: c.staffChoose })));
    setNextKey(current.length + 1);
    setReason("");
    setError(null);
    fetchPackageOptions(supabase, customerId, appointmentId).then(setParts);
  }, [open, current, customerId, appointmentId, supabase]);

  const filtered = useMemo(() => {
    const t = normalizeText(q.trim());
    if (!t) return [];
    return services
      .filter((s) => s.branch_id === null || s.branch_id === branchId)
      .filter((s) => normalizeText(`${s.name} ${s.name_en ?? ""}`).includes(t))
      .slice(0, 10);
  }, [q, services, branchId]);

  function add(serviceId: string, partId?: string | null) {
    const best = partId !== undefined ? partId : bestPart(parts, serviceId, usageOf(rows))?.item_id ?? null;
    setRows((p) => [...p, { key: nextKey, serviceId, technicianId: "", partId: best, staffChoose: false }]);
    setNextKey((k) => k + 1);
    setQ("");
  }
  function patch(key: number, x: Partial<Row>) {
    setRows((p) => p.map((r) => (r.key === key ? { ...r, ...x } : r)));
  }

  async function save() {
    if (rows.length === 0) return setError("Chọn ít nhất 1 dịch vụ.");
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("set_appointment_services", {
      p_appt: appointmentId,
      p_items: rows.map((r) => ({
        service_id: r.serviceId,
        technician_id: r.technicianId || null,
        customer_package_item_id: r.partId,
        staff_choose: r.staffChoose,
      })),
      p_reason: reason.trim() || null,
    });
    setBusy(false);
    if (error) return setError(vnError(error.message));
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button className={consult ? "btn-primary py-2" : "btn-outline py-2"} onClick={() => setOpen(true)}>
        {consult ? "Chọn dịch vụ sau tư vấn" : "Đổi dịch vụ"}
      </button>
    );
  }

  return (
    <div className="mt-3 w-full space-y-2 rounded-xl border-2 border-navy/30 bg-cream p-3 text-sm">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-navy">Đổi dịch vụ khách làm</p>
        <button className="text-ink/50" onClick={() => setOpen(false)} aria-label="Đóng">✕</button>
      </div>

      {parts.length > 0 && (
        <div className="rounded-lg bg-white px-3 py-2 text-xs">
          <p className="mb-1 font-semibold text-[#22612A]">Gói khách đang có (bấm để thêm buổi)</p>
          {parts.map((o) => {
            const left = partLeft(o, usageOf(rows).get(o.item_id) ?? 0);
            const opts = o.service_ids.map((id) => byId.get(id)).filter((x): x is EditorService => !!x);
            return (
              <div key={o.item_id} className="flex flex-wrap items-center gap-2 py-0.5">
                <span className="flex-1">
                  {partName(o)} · {partLeftText(o, usageOf(rows).get(o.item_id) ?? 0)}
                  {o.expires_at && ` · hạn ${shortDmy(o.expires_at)}`}
                </span>
                {left > 0 && (
                  <select className="rounded border border-beige-dark px-1 py-0.5" value="" onChange={(e) => e.target.value && add(e.target.value, o.item_id)}>
                    <option value="">+ Thêm…</option>
                    {opts.map((v) => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ul className="space-y-2">
        {rows.map((r, i) => {
          const s = byId.get(r.serviceId);
          const others = usageOf(rows, i);
          const opts = parts.filter((o) => o.service_ids.includes(r.serviceId) && (o.item_id === r.partId || partLeft(o, others.get(o.item_id) ?? 0) > 0));
          return (
            <li key={r.key} className="rounded-lg bg-white p-2">
              <div className="flex items-start justify-between gap-2">
                <span>
                  <b>{s?.name ?? "Dịch vụ"}</b>
                  <span className="block text-xs text-ink/60">
                    {formatDuration(s?.duration_minutes ?? 60)} · {r.partId ? "trừ buổi gói" : formatVnd(s?.price)}
                  </span>
                </span>
                <button className="text-[#8A2323]" onClick={() => setRows((p) => p.filter((x) => x.key !== r.key))} aria-label="Bỏ">✕</button>
              </div>
              {opts.length > 0 && (
                <select className="mt-1 w-full rounded border border-beige-dark px-2 py-1 text-xs" value={r.partId ?? ""} onChange={(e) => patch(r.key, { partId: e.target.value || null, staffChoose: false })}>
                  {opts.map((o) => (
                    <option key={o.item_id} value={o.item_id}>
                      Trừ buổi: {partName(o)} ({partLeftText(o, others.get(o.item_id) ?? 0)})
                    </option>
                  ))}
                  <option value="">Không trừ gói – thanh toán thường</option>
                </select>
              )}
              <select className="mt-1 w-full rounded border border-beige-dark px-2 py-1 text-xs" value={r.technicianId} onChange={(e) => patch(r.key, { technicianId: e.target.value })}>
                <option value="">— Chưa xếp KTV —</option>
                {technicians.map((t) => (
                  <option key={t.id} value={t.id}>{techLabel(t, branches)}</option>
                ))}
              </select>
            </li>
          );
        })}
      </ul>

      <input className="input py-2 text-sm" placeholder="Thêm dịch vụ (gõ tên)…" value={q} onChange={(e) => setQ(e.target.value)} />
      {filtered.length > 0 && (
        <ul className="max-h-60 divide-y divide-beige overflow-y-auto rounded-lg border border-beige-dark bg-white">
          {filtered.map((s) => (
            <li key={s.id}>
              <button className="flex w-full justify-between gap-2 px-3 py-2 text-left hover:bg-cream" onClick={() => add(s.id)}>
                <span>{s.name}</span>
                <span className="shrink-0 text-navy">{formatVnd(s.price)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <input className="input py-2 text-sm" placeholder="Lý do đổi (vd: KTV tư vấn, khách đổi sang B)" value={reason} onChange={(e) => setReason(e.target.value)} />
      {error && <p className="text-xs text-[#8A2323]">{error}</p>}
      <div className="flex justify-end gap-2">
        <button className="btn-ghost py-2" onClick={() => setOpen(false)}>Huỷ</button>
        <button className="btn-primary py-2" disabled={busy} onClick={save}>{busy ? "Đang lưu…" : "Lưu dịch vụ mới"}</button>
      </div>
    </div>
  );
}
