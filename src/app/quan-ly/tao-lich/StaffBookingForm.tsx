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
import { DEFAULT_CAPACITY, addDays, peakLoad, toIntervals, type Interval } from "@/lib/calendar";

export type StaffService = {
  id: string;
  category_id: string | null;
  name: string;
  name_en: string | null;
  duration_minutes: number;
  price: number | null;
  branch_id: string | null;
};
type Customer = { id: string; full_name: string; phone: string | null; note: string | null };
type Item = { key: number; serviceId: string; technicianId: string; minutes?: number };

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
  initialDate,
  initialTime,
  canOverbook,
  branches,
  categories,
  services,
  technicians,
}: {
  defaultBranchId: string;
  initialPhone: string;
  initialDate?: string;
  initialTime?: string;
  canOverbook: boolean;
  branches: { id: string; name: string; max_per_slot?: number | null }[];
  categories: { id: string; name: string; sort_order: number }[];
  services: StaffService[];
  technicians: Technician[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [source, setSource] = useState<"phone" | "walk_in">("phone");
  const [branchId, setBranchId] = useState(defaultBranchId);

  // khách
  const [phone, setPhone] = useState(initialPhone);
  const [matches, setMatches] = useState<Customer[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [newName, setNewName] = useState("");

  // dịch vụ
  const [items, setItems] = useState<Item[]>([]);
  const [query, setQuery] = useState("");
  const [nextKey, setNextKey] = useState(1);

  // giờ
  const [date, setDate] = useState(initialDate ?? todayVn());
  const [time, setTime] = useState(initialTime ?? "");
  const [branchLoad, setBranchLoad] = useState<Interval[] | null>(null);
  const [busy, setBusy] = useState<Busy[]>([]);
  const [note, setNote] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; start: string; name: string } | null>(null);

  const byId = useMemo(() => new Map(services.map((s) => [s.id, s])), [services]);
  const digits = normalizePhone(phone);

  // tìm khách theo SĐT (gõ từ 4 số)
  useEffect(() => {
    setCustomer(null);
    if (digits.length < 4) {
      setMatches(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from("customers")
        .select("id, full_name, phone, note")
        .ilike("phone", `%${digits}%`)
        .order("full_name")
        .limit(8);
      if (cancelled) return;
      const list = (data ?? []) as Customer[];
      setMatches(list);
      setSearching(false);
      const exact = list.find((c) => c.phone === digits);
      if (exact) setCustomer(exact);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [digits, supabase]);

  // lịch bận của KTV trong ngày
  useEffect(() => {
    if (!date) return;
    const from = vnDateTime(date, "00:00").toISOString();
    const to = new Date(vnDateTime(date, "00:00").getTime() + 86400000).toISOString();
    fetchBusy(supabase, from, to).then(setBusy);
  }, [date, supabase]);

  // số khách đã có ở chi nhánh trong ngày (để báo đủ chỗ)
  useEffect(() => {
    if (!date || !branchId) return;
    let off = false;
    supabase
      .from("appointments")
      .select("start_at, end_at")
      .eq("branch_id", branchId)
      .not("status", "in", "(cancelled,no_show)")
      .gte("start_at", vnDateTime(date, "00:00").toISOString())
      .lt("start_at", vnDateTime(addDays(date, 1), "00:00").toISOString())
      .then(({ data }) => {
        if (!off) setBranchLoad(toIntervals((data ?? []) as { start_at: string; end_at: string | null }[]));
      });
    return () => {
      off = true;
    };
  }, [date, branchId, supabase]);

  useEffect(() => {
    if (source === "walk_in") {
      setDate(todayVn());
      setTime(nowRounded());
    }
  }, [source]);

  const filtered = useMemo(() => {
    const q = normalizeText(query.trim());
    if (!q) return [];
    return services
      .filter((s) => s.branch_id === null || s.branch_id === branchId)
      .filter((s) => normalizeText(`${s.name} ${s.name_en ?? ""}`).includes(q))
      .slice(0, 12);
  }, [services, query, branchId]);

  // giờ bắt đầu / kết thúc của từng dịch vụ (làm lần lượt)
  const timeline = useMemo(() => {
    if (!date || !time) return [];
    let cursor = vnDateTime(date, time).getTime();
    return items.map((it) => {
      const dur = it.minutes ?? byId.get(it.serviceId)?.duration_minutes ?? 60;
      const start = new Date(cursor).toISOString();
      cursor += dur * 60000;
      return { start, end: new Date(cursor).toISOString() };
    });
  }, [items, date, time, byId]);

  const chosen = items.map((it) => byId.get(it.serviceId)).filter((s): s is StaffService => !!s);
  const totalMinutes = items.reduce((a, it) => a + (it.minutes ?? byId.get(it.serviceId)?.duration_minutes ?? 0), 0);
  const knownTotal = chosen.reduce((a, s) => a + (s.price ?? 0), 0);
  const hasQuote = chosen.some((s) => s.price === null);
  const cap = branches.find((b) => b.id === branchId)?.max_per_slot ?? DEFAULT_CAPACITY;
  const slotLoad =
    branchLoad && date && /^\d{2}:\d{2}/.test(time)
      ? peakLoad(branchLoad, vnDateTime(date, time.slice(0, 5)).getTime(), vnDateTime(date, time.slice(0, 5)).getTime() + (totalMinutes || 60) * 60000)
      : null;

  function addService(id: string) {
    setError(null);
    if (items.length >= MAX_ITEMS) return setError(`Mỗi lịch tối đa ${MAX_ITEMS} dịch vụ.`);
    setItems((prev) => [...prev, { key: nextKey, serviceId: id, technicianId: "" }]);
    setNextKey((k) => k + 1);
    setQuery("");
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

  const isNew = !customer && digits.length >= 9 && matches !== null && !matches.some((c) => c.phone === digits);

  async function submit() {
    setError(null);
    if (!branchId) return setError("Vui lòng chọn chi nhánh.");
    if (!customer) {
      if (digits.length < 9 || digits.length > 11) return setError("Vui lòng nhập số điện thoại khách (9–11 số).");
      if (!newName.trim()) return setError("Khách mới: vui lòng nhập tên khách.");
    }
    if (items.length === 0) return setError("Vui lòng chọn ít nhất 1 dịch vụ.");
    if (!date || !time) return setError("Vui lòng chọn ngày giờ.");

    setSaving(true);
    const { data, error: e } = await supabase.rpc("create_staff_booking", {
      p_branch_id: branchId,
      p_start_at: vnDateTime(date, time).toISOString(),
      p_source: source,
      p_items: items.map((it) => ({ service_id: it.serviceId, technician_id: it.technicianId || null, ...(it.minutes ? { minutes: it.minutes } : {}) })),
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
    setPhone("");
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
        <label className="label" htmlFor="phone">Số điện thoại</label>
        <input
          id="phone"
          className="input"
          inputMode="tel"
          placeholder="Nhập SĐT khách để tìm"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoFocus
        />
        {searching && digits.length >= 4 && <p className="mt-2 text-xs text-ink/50">Đang tìm…</p>}

        {customer ? (
          <div className="mt-3 flex items-start justify-between gap-3 rounded-xl bg-[#D6EDD8]/60 p-3">
            <div>
              <p className="font-semibold">{customer.full_name}</p>
              <p className="text-sm text-ink/70">{customer.phone}</p>
              {customer.note && <p className="mt-1 text-xs text-ink/70">Ghi chú: {customer.note}</p>}
            </div>
            <button type="button" className="text-sm text-navy underline" onClick={() => setCustomer(null)}>Đổi</button>
          </div>
        ) : (
          matches &&
          matches.length > 0 && (
            <ul className="mt-3 divide-y divide-beige rounded-xl border border-beige-dark/70">
              {matches.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => setCustomer(c)} className="flex w-full justify-between px-4 py-2.5 text-left text-sm hover:bg-cream">
                    <span className="font-medium">{c.full_name}</span>
                    <span className="text-ink/60">{c.phone}</span>
                  </button>
                </li>
              ))}
            </ul>
          )
        )}

        {isNew && (
          <div className="mt-3 rounded-xl bg-cream p-3">
            <p className="mb-2 text-sm"><b>Khách mới</b> – chưa có hồ sơ với SĐT {digits}. Nhập tên để tạo hồ sơ:</p>
            <input className="input" placeholder="Họ tên khách" value={newName} onChange={(e) => setNewName(e.target.value)} />
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
        {slotLoad !== null && (
          <p
            className={`mt-2 rounded-lg px-3 py-2 text-sm ${
              slotLoad >= cap ? "bg-[#FCE4E4] text-[#8A2323]" : slotLoad === cap - 1 ? "bg-[#FFF3D6] text-[#7A5600]" : "bg-[#E3F3E5] text-[#22612A]"
            }`}
          >
            {slotLoad >= cap
              ? `Khung giờ này đã đủ ${cap} khách${canOverbook ? " – bạn là chủ / quản lý nên vẫn xếp thêm được." : ". Vui lòng chọn giờ khác hoặc nhờ quản lý xếp thêm."}`
              : `Khung giờ này đang có ${slotLoad}/${cap} khách cùng lúc – còn ${cap - slotLoad} chỗ.`}
          </p>
        )}
      </section>

      {/* Dịch vụ + KTV */}
      <section className="card">
        <h2 className="mb-3 font-semibold text-navy">3. Dịch vụ và kỹ thuật viên</h2>
        {items.length > 0 && (
          <ul className="mb-3 space-y-2">
            {items.map((it, i) => {
              const s = byId.get(it.serviceId);
              const tl = timeline[i];
              return (
                <li key={it.key} className="rounded-xl border border-beige-dark/70 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{s?.name}</p>
                      <p className="text-xs text-ink/60">
                        {tl ? `${formatTime(tl.start)} – ${formatTime(tl.end)} · ` : ""}
                        {formatDuration(it.minutes ?? s?.duration_minutes ?? 0)}
                        {it.minutes && it.minutes !== s?.duration_minutes ? " (đã đổi)" : ""} · {formatVnd(s?.price)}
                      </p>
                      {canOverbook && (
                        <label className="mt-1 flex items-center gap-1.5 text-xs text-ink/70">
                          Thời gian làm
                          <input
                            className="w-16 rounded-lg border border-beige-dark px-2 py-1 text-sm"
                            inputMode="numeric"
                            value={it.minutes ?? s?.duration_minutes ?? ""}
                            onChange={(e) => {
                              const v = Number(e.target.value.replace(/\D/g, "")) || undefined;
                              setItems((p) => p.map((x) => (x.key === it.key ? { ...x, minutes: v } : x)));
                            }}
                          />
                          phút
                        </label>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-1 text-sm">
                      <button type="button" className="px-1.5 text-ink/50" onClick={() => move(i, -1)} aria-label="Lên">↑</button>
                      <button type="button" className="px-1.5 text-ink/50" onClick={() => move(i, 1)} aria-label="Xuống">↓</button>
                      <button type="button" className="px-1.5 text-[#8A2323]" onClick={() => setItems((p) => p.filter((x) => x.key !== it.key))} aria-label="Bỏ">✕</button>
                    </div>
                  </div>
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
          value={query}
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
        {query.trim() && filtered.length === 0 && <p className="mt-2 text-sm text-ink/60">Không tìm thấy dịch vụ.</p>}
      </section>

      <section className="card">
        <h2 className="mb-3 font-semibold text-navy">4. Ghi chú <span className="font-normal text-ink/50">(không bắt buộc)</span></h2>
        <textarea className="input min-h-20" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      </section>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-beige-dark bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <div className="flex-1 text-sm">
            {chosen.length === 0 ? (
              <span className="text-ink/60">Chưa chọn dịch vụ</span>
            ) : (
              <>
                <b className="text-navy">{chosen.length} dịch vụ · {formatDuration(totalMinutes)}</b>
                <br />
                <span className="text-ink/70">
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
