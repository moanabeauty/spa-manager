"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  formatDate,
  formatDuration,
  formatTime,
  formatVnd,
  normalizePhone,
  normalizeText,
  todayVn,
  vnDateTime,
  vnError,
} from "@/lib/format";
import { fetchBusy, isBusy, techLabel, type Busy, type Technician } from "@/lib/staff";
import CustomerSearch, { type CustomerHit } from "@/components/CustomerSearch";
import {
  bestPart,
  fetchPackageOptions,
  partLeft,
  partLeftText,
  partName,
  shortDmy,
  usageOf,
  type PackageOption,
} from "@/lib/packageBooking";

export type StaffService = {
  id: string;
  category_id: string | null;
  name: string;
  name_en: string | null;
  duration_minutes: number;
  price: number | null;
  branch_id: string | null;
};
type Customer = Pick<CustomerHit, "id" | "full_name" | "phone" | "note"> & Partial<CustomerHit>;
/** serviceId = "" + partId: KTV chọn loại cụ thể khi khách đến (phần gói "các loại") */
type Item = { key: number; serviceId: string; technicianId: string; partId: string | null; staffChoose: boolean };

const MAX_ITEMS = 10;

function nowRounded(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 9);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const mm = Math.floor(m / 5) * 5;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export default function StaffBookingForm({
  defaultBranchId,
  initialPhone,
  branches,
  categories,
  services,
  technicians,
}: {
  defaultBranchId: string;
  initialPhone: string;
  branches: { id: string; name: string }[];
  categories: { id: string; name: string; sort_order: number }[];
  services: StaffService[];
  technicians: Technician[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [source, setSource] = useState<"phone" | "walk_in">("phone");
  const [branchId, setBranchId] = useState(defaultBranchId);

  // khách
  const [query, setCustQuery] = useState(initialPhone);
  const [hits, setHits] = useState<CustomerHit[] | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [newName, setNewName] = useState("");
  const [parts, setParts] = useState<PackageOption[]>([]);
  const [consult, setConsult] = useState(false);

  // dịch vụ
  const [items, setItems] = useState<Item[]>([]);
  const [svcQuery, setQuery] = useState("");
  const [nextKey, setNextKey] = useState(1);

  // giờ
  const [date, setDate] = useState(todayVn());
  const [time, setTime] = useState("");
  const [busy, setBusy] = useState<Busy[]>([]);
  const [note, setNote] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; start: string; name: string } | null>(null);

  const byId = useMemo(() => new Map(services.map((s) => [s.id, s])), [services]);
  const digits = normalizePhone(query);
  const partById = useMemo(() => new Map(parts.map((o) => [o.item_id, o])), [parts]);

  // gói khách đang có → gợi ý trừ buổi
  useEffect(() => {
    if (!customer) {
      setParts([]);
      setItems((prev) => prev.map((it) => ({ ...it, partId: null, staffChoose: false })).filter((it) => it.serviceId));
      return;
    }
    let cancelled = false;
    fetchPackageOptions(supabase, customer.id).then((o) => {
      if (cancelled) return;
      setParts(o);
      // dịch vụ đã chọn trước khi chọn khách: tự gắn phần gói có lợi nhất
      setItems((prev) => {
        const next: Item[] = [];
        for (const it of prev) {
          const best = it.serviceId ? bestPart(o, it.serviceId, usageOf(next)) : null;
          next.push({ ...it, partId: best?.item_id ?? null, staffChoose: false });
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [customer, supabase]);

  // lịch bận của KTV trong ngày
  useEffect(() => {
    if (!date) return;
    const from = vnDateTime(date, "00:00").toISOString();
    const to = new Date(vnDateTime(date, "00:00").getTime() + 86400000).toISOString();
    fetchBusy(supabase, from, to).then(setBusy);
  }, [date, supabase]);

  useEffect(() => {
    if (source === "walk_in") {
      setDate(todayVn());
      setTime(nowRounded());
    }
  }, [source]);

  const filtered = useMemo(() => {
    const q = normalizeText(svcQuery.trim());
    if (!q) return [];
    return services
      .filter((s) => s.branch_id === null || s.branch_id === branchId)
      .filter((s) => normalizeText(`${s.name} ${s.name_en ?? ""}`).includes(q))
      .slice(0, 12);
  }, [services, svcQuery, branchId]);

  // giờ bắt đầu / kết thúc của từng dịch vụ (làm lần lượt)
  const timeline = useMemo(() => {
    if (!date || !time) return [];
    let cursor = vnDateTime(date, time).getTime();
    return items.map((it) => {
      const dur = (it.serviceId && byId.get(it.serviceId)?.duration_minutes) || 60;
      const start = new Date(cursor).toISOString();
      cursor += dur * 60000;
      return { start, end: new Date(cursor).toISOString() };
    });
  }, [items, date, time, byId]);

  const totalMinutes = items.reduce((a, it) => a + ((it.serviceId && byId.get(it.serviceId)?.duration_minutes) || 60), 0);
  const paid = items.filter((it) => !it.partId).map((it) => byId.get(it.serviceId)).filter((s): s is StaffService => !!s);
  const knownTotal = paid.reduce((a, s) => a + (s.price ?? 0), 0);
  const hasQuote = paid.some((s) => s.price === null);
  const fromPackage = items.filter((it) => it.partId).length;

  function addService(id: string) {
    setError(null);
    if (items.length >= MAX_ITEMS) return setError(`Mỗi lịch tối đa ${MAX_ITEMS} dịch vụ.`);
    const best = bestPart(parts, id, usageOf(items));
    setItems((prev) => [...prev, { key: nextKey, serviceId: id, technicianId: "", partId: best?.item_id ?? null, staffChoose: false }]);
    setNextKey((k) => k + 1);
    setQuery("");
  }
  function addFromPart(o: PackageOption, serviceId: string) {
    setError(null);
    if (items.length >= MAX_ITEMS) return setError(`Mỗi lịch tối đa ${MAX_ITEMS} dịch vụ.`);
    setItems((prev) => [...prev, { key: nextKey, serviceId, technicianId: "", partId: o.item_id, staffChoose: serviceId === "" }]);
    setNextKey((k) => k + 1);
  }
  function itemName(it: Item) {
    if (it.serviceId) return byId.get(it.serviceId)?.name ?? "Dịch vụ";
    const o = it.partId ? partById.get(it.partId) : null;
    return o ? `${o.label} – KTV chọn loại khi khách đến` : "Dịch vụ";
  }
  function move(i: number, d: -1 | 1) {
    setItems((prev) => {
      const next = [...prev];
      const j = i + d;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  const isNew = !customer && digits.length >= 9 && digits.length === query.replace(/[\s.+-]/g, "").length && hits !== null && !hits.some((c) => c.phone === digits);

  async function submit() {
    setError(null);
    if (!branchId) return setError("Vui lòng chọn chi nhánh.");
    if (!customer) {
      if (digits.length < 9 || digits.length > 11) return setError("Vui lòng nhập số điện thoại khách (9–11 số).");
      if (!newName.trim()) return setError("Khách mới: vui lòng nhập tên khách.");
    }
    if (items.length === 0 && !consult) return setError("Vui lòng chọn ít nhất 1 dịch vụ, hoặc bật “Chưa chọn dịch vụ – tư vấn khi khách đến”.");
    if (!date || !time) return setError("Vui lòng chọn ngày giờ.");

    setSaving(true);
    const { data, error: e } = await supabase.rpc("create_staff_booking_v2", {
      p_branch_id: branchId,
      p_start_at: vnDateTime(date, time).toISOString(),
      p_source: source,
      p_items: items.map((it) => ({
        service_id: it.serviceId || null,
        technician_id: it.technicianId || null,
        customer_package_item_id: it.partId,
        staff_choose: it.staffChoose,
      })),
      p_consult: consult,
      p_customer_id: customer?.id ?? null,
      p_customer_name: customer ? null : newName.trim(),
      p_customer_phone: customer ? null : digits,
      p_note: note.trim() || null,
    });
    setSaving(false);
    if (e) return setError(vnError(e.message));
    setDone({ id: data as string, start: vnDateTime(date, time).toISOString(), name: customer?.full_name ?? newName.trim() });
  }

  function reset() {
    setDone(null);
    setCustQuery("");
    setConsult(false);
    setNewName("");
    setCustomer(null);
    setItems([]);
    setNote("");
    setTime(source === "walk_in" ? nowRounded() : "");
  }

  if (done) {
    return (
      <div className="card text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[#D6EDD8] text-2xl text-[#22612A]">✓</div>
        <h1 className="text-xl font-bold text-navy">Đã tạo lịch cho {done.name}</h1>
        <p className="mt-2 text-sm text-ink/80">
          {formatTime(done.start)} · {formatDate(done.start)}
          <br />
          {branches.find((b) => b.id === branchId)?.name}
          {source === "walk_in" ? " · Khách đang ở spa (Đang làm)" : " · Đã xác nhận"}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href={`/quan-ly/lich-hen?ngay=${date}&cn=${branchId}`} className="btn-primary">Xem lịch trong ngày</Link>
          <button className="btn-outline" onClick={reset}>Tạo lịch khác</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-28">
      <h1 className="text-2xl font-bold text-navy">Tạo lịch tại quầy</h1>

      {/* Loại khách + chi nhánh */}
      <section className="card space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {([
            ["phone", "📞 Khách gọi điện", "Lịch đã xác nhận"],
            ["walk_in", "🚶 Khách vãng lai", "Khách đang ở spa, làm ngay"],
          ] as const).map(([v, label, hint]) => (
            <button
              key={v}
              type="button"
              onClick={() => setSource(v)}
              className={`rounded-xl border p-3 text-left ${source === v ? "border-navy bg-navy text-white" : "border-beige-dark bg-cream"}`}
            >
              <p className="font-semibold">{label}</p>
              <p className={`text-xs ${source === v ? "text-beige" : "text-ink/60"}`}>{hint}</p>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {branches.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setBranchId(b.id)}
              className={`rounded-full px-4 py-2 text-sm font-semibold ${b.id === branchId ? "bg-navy text-white" : "bg-white text-navy ring-1 ring-beige-dark"}`}
            >
              {b.name}
            </button>
          ))}
        </div>
      </section>

      {/* Khách */}
      <section className="card">
        <h2 className="mb-3 font-semibold text-navy">1. Khách hàng</h2>
        {customer ? (
          <div className="flex items-start justify-between gap-3 rounded-xl bg-[#D6EDD8]/60 p-3">
            <div>
              <p className="font-semibold">
                {customer.full_name} {customer.code && <span className="ml-1 font-mono text-xs text-brown">{customer.code}</span>}
              </p>
              <p className="text-sm text-ink/70">{customer.phone}</p>
              {customer.note && <p className="mt-1 text-xs text-ink/70">Ghi chú: {customer.note}</p>}
            </div>
            <button type="button" className="text-sm text-navy underline" onClick={() => setCustomer(null)}>Đổi</button>
          </div>
        ) : (
          <CustomerSearch
            label="Tìm khách: SĐT, mã KH hoặc tên"
            initialQuery={initialPhone}
            autoFocus
            onPick={(c) => setCustomer(c)}
            onQueryChange={(q, h) => {
              setCustQuery(q);
              setHits(h);
            }}
            emptyHint={digits.length >= 9 ? <>Chưa có khách với SĐT {digits} – nhập tên bên dưới để tạo hồ sơ mới.</> : <>Không tìm thấy. Khách mới: gõ đủ SĐT để tạo hồ sơ.</>}
          />
        )}

        {isNew && (
          <div className="mt-3 rounded-xl bg-cream p-3">
            <p className="mb-2 text-sm"><b>Khách mới</b> – chưa có hồ sơ với SĐT {digits}. Nhập tên để tạo hồ sơ:</p>
            <input className="input" placeholder="Họ tên khách" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </div>
        )}

        {customer && parts.length > 0 && (
          <div className="mt-3 rounded-xl border border-[#22612A]/30 bg-[#D6EDD8]/30 p-3 text-sm">
            <p className="mb-1 font-semibold text-[#22612A]">Gói khách đang có – bấm để thêm buổi vào lịch</p>
            <ul className="space-y-1.5">
              {parts.map((o) => {
                const left = partLeft(o, usageOf(items).get(o.item_id) ?? 0);
                const svcs = o.service_ids.map((id) => byId.get(id)).filter((x): x is StaffService => !!x && (x.branch_id === null || x.branch_id === branchId));
                return (
                  <li key={o.item_id} className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1">
                      {partName(o)}{" "}
                      <span className="text-xs text-ink/60">
                        · {partLeftText(o, usageOf(items).get(o.item_id) ?? 0)}
                        {o.reserved > 0 && ` (${o.reserved} đã đặt)`}
                        {o.expires_at && ` · hạn ${shortDmy(o.expires_at)}`}
                      </span>
                    </span>
                    {left > 0 &&
                      (svcs.length === 1 ? (
                        <button type="button" className="btn-outline py-1 text-xs" onClick={() => addFromPart(o, svcs[0].id)}>+ Thêm</button>
                      ) : (
                        <select
                          className="rounded-lg border border-beige-dark bg-white px-2 py-1 text-xs"
                          value="-"
                          onChange={(e) => e.target.value !== "-" && addFromPart(o, e.target.value === "_" ? "" : e.target.value)}
                        >
                          <option value="-">+ Thêm buổi…</option>
                          {o.staff_choice && <option value="_">KTV chọn loại khi khách đến</option>}
                          {svcs.map((v) => (
                            <option key={v.id} value={v.id}>{v.name}</option>
                          ))}
                        </select>
                      ))}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      {/* Giờ */}
      <section className="card">
        <h2 className="mb-3 font-semibold text-navy">2. Ngày giờ bắt đầu</h2>
        <div className="grid grid-cols-2 gap-2">
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          <input type="time" step={300} className="input" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
      </section>

      {/* Dịch vụ + KTV */}
      <section className="card">
        <h2 className="mb-3 font-semibold text-navy">3. Dịch vụ và kỹ thuật viên</h2>
        <label className={`mb-3 flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm ${consult ? "border-navy bg-beige" : "border-beige-dark bg-cream"}`}>
          <input type="checkbox" className="mt-1" checked={consult} onChange={(e) => setConsult(e.target.checked)} />
          <span>
            <b>Chưa chọn dịch vụ – quản lý tư vấn khi khách đến</b>
            <span className="block text-xs text-ink/60">Có thể tạo lịch không có dịch vụ; khi khách đến quản lý bấm “Đổi dịch vụ” trên lịch hẹn.</span>
          </span>
        </label>
        {items.length > 0 && (
          <ul className="mb-3 space-y-2">
            {items.map((it, i) => {
              const s = byId.get(it.serviceId);
              const tl = timeline[i];
              return (
                <li key={it.key} className="rounded-xl border border-beige-dark/70 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{itemName(it)}</p>
                      <p className="text-xs text-ink/60">
                        {tl ? `${formatTime(tl.start)} – ${formatTime(tl.end)} · ` : ""}
                        {formatDuration(s?.duration_minutes ?? 60)} · {it.partId ? <b className="text-[#22612A]">trừ buổi gói</b> : formatVnd(s?.price)}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1 text-sm">
                      <button type="button" className="px-1.5 text-ink/50" onClick={() => move(i, -1)} aria-label="Lên">↑</button>
                      <button type="button" className="px-1.5 text-ink/50" onClick={() => move(i, 1)} aria-label="Xuống">↓</button>
                      <button type="button" className="px-1.5 text-[#8A2323]" onClick={() => setItems((p) => p.filter((x) => x.key !== it.key))} aria-label="Bỏ">✕</button>
                    </div>
                  </div>
                  {it.serviceId && (() => {
                    const others = usageOf(items, i);
                    const opts = parts.filter((o) => o.service_ids.includes(it.serviceId) && (o.item_id === it.partId || partLeft(o, others.get(o.item_id) ?? 0) > 0));
                    if (opts.length === 0) return null;
                    return (
                      <select
                        className={`input mt-2 py-1.5 text-xs ${it.partId ? "border-[#22612A]/50 bg-[#D6EDD8]/40" : ""}`}
                        value={it.partId ?? ""}
                        onChange={(e) => setItems((p) => p.map((x) => (x.key === it.key ? { ...x, partId: e.target.value || null } : x)))}
                      >
                        {opts.map((o) => (
                          <option key={o.item_id} value={o.item_id}>
                            Trừ buổi: {partName(o)} ({partLeftText(o, others.get(o.item_id) ?? 0)}
                            {o.expires_at ? `, hạn ${shortDmy(o.expires_at)}` : ""})
                          </option>
                        ))}
                        <option value="">Không trừ gói – thanh toán thường</option>
                      </select>
                    );
                  })()}
                  <select
                    className="input mt-2 py-2 text-sm"
                    value={it.technicianId}
                    onChange={(e) => setItems((p) => p.map((x) => (x.key === it.key ? { ...x, technicianId: e.target.value } : x)))}
                  >
                    <option value="">— Chưa xếp KTV —</option>
                    {technicians.map((t) => {
                      const b = tl ? isBusy(busy, t.id, tl.start, tl.end) : false;
                      // cùng KTV ở một dịch vụ khác của lịch này mà trùng giờ
                      const selfClash =
                        tl && items.some((o, j) => j !== i && o.technicianId === t.id && timeline[j] && timeline[j].start < tl.end && timeline[j].end > tl.start);
                      return (
                        <option key={t.id} value={t.id}>
                          {techLabel(t, branches)}
                          {b || selfClash ? " (bận)" : ""}
                        </option>
                      );
                    })}
                  </select>
                </li>
              );
            })}
          </ul>
        )}
        <input
          className="input"
          placeholder={items.length ? "Thêm dịch vụ khác…" : "Gõ tên dịch vụ để thêm (vd: peel, mụn, gội…)"}
          value={svcQuery}
          onChange={(e) => setQuery(e.target.value)}
        />
        {filtered.length > 0 && (
          <ul className="mt-2 max-h-72 divide-y divide-beige overflow-y-auto rounded-xl border border-beige-dark/70">
            {filtered.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => addService(s.id)} className="flex w-full items-start justify-between gap-3 px-4 py-2.5 text-left text-sm hover:bg-cream">
                  <span>
                    {s.name}
                    <span className="block text-xs text-ink/50">
                      {categories.find((c) => c.id === s.category_id)?.name} · {formatDuration(s.duration_minutes)}
                    </span>
                  </span>
                  <span className="shrink-0 font-semibold text-navy">{formatVnd(s.price)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {svcQuery.trim() && filtered.length === 0 && <p className="mt-2 text-sm text-ink/60">Không tìm thấy dịch vụ.</p>}
      </section>

      <section className="card">
        <h2 className="mb-3 font-semibold text-navy">4. Ghi chú <span className="font-normal text-ink/50">(không bắt buộc)</span></h2>
        <textarea className="input min-h-20" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      </section>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-beige-dark bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <div className="flex-1 text-sm">
            {items.length === 0 ? (
              <span className="text-ink/60">{consult ? "Lịch tư vấn – chưa chọn dịch vụ" : "Chưa chọn dịch vụ"}</span>
            ) : (
              <>
                <b className="text-navy">{items.length} dịch vụ · {formatDuration(totalMinutes)}</b>
                <br />
                <span className="text-ink/70">
                  {fromPackage > 0 && `${fromPackage} trừ gói · `}
                  Tạm tính {formatVnd(knownTotal)}
                  {hasQuote && " + báo giá"}
                </span>
              </>
            )}
            {error && <p className="mt-1 text-xs font-medium text-[#8A2323]">{error}</p>}
          </div>
          <button className="btn-primary px-6 py-3" disabled={saving} onClick={submit}>
            {saving ? "Đang lưu…" : "Tạo lịch"}
          </button>
        </div>
      </div>
    </div>
  );
}
