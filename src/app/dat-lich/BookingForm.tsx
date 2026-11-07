"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  LAST_START_HOUR,
  MAX_DAYS_AHEAD,
  MIN_LEAD_MINUTES,
  OPEN_HOUR,
  SLOT_MINUTES,
} from "@/lib/config";
import { formatDate, formatDuration, formatTime, formatVnd, todayVn, vnDateTime, vnError } from "@/lib/format";
import {
  DEFAULT_CAPACITY,
  WEEKDAYS,
  addDays,
  monthGrid,
  monthLabel,
  monthOf,
  peakLoad,
  shiftMonth,
  toIntervals,
  type Interval,
} from "@/lib/calendar";

export type Branch = { id: string; name: string; address: string; max_per_slot?: number | null };
export type Category = { id: string; name: string; sort_order: number };
export type Service = {
  id: string;
  category_id: string | null;
  name: string;
  name_en: string | null;
  description: string | null;
  duration_minutes: number;
  price: number | null;
  branch_id: string | null;
};

const MAX_SERVICES = 5;
const CONSULT_MINUTES = 60; // lịch tư vấn tạm giữ 60 phút, chuyên viên chọn liệu trình khi khách đến

function buildSlots(): string[] {
  const out: string[] = [];
  for (let m = OPEN_HOUR * 60; m <= LAST_START_HOUR * 60 + 30; m += SLOT_MINUTES) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  return out;
}
const SLOTS = buildSlots();

function normalize(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d");
}

export default function BookingForm({
  customerId,
  customerName,
  branches,
  categories,
  services,
}: {
  customerId: string;
  customerName: string;
  branches: Branch[];
  categories: Category[];
  services: Service[];
}) {
  const [branchId, setBranchId] = useState<string>(branches[0]?.id ?? "");
  const [selected, setSelected] = useState<string[]>([]);
  const [consult, setConsult] = useState(false);
  const [query, setQuery] = useState("");
  const [openCat, setOpenCat] = useState<string | null>(null);
  const [date, setDate] = useState<string>(todayVn());
  const [time, setTime] = useState<string>("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ start: string } | null>(null);
  const [ym, setYm] = useState<string>(monthOf(todayVn()));
  const [monthLoad, setMonthLoad] = useState<Map<string, { full: number; slots: number }>>(new Map());
  const [dayBusy, setDayBusy] = useState<Interval[] | null>(null);
  const supabase = useMemo(() => createClient(), []);
  const cap = branches.find((b) => b.id === branchId)?.max_per_slot ?? DEFAULT_CAPACITY;
  const minDay = todayVn();
  const maxDay = todayVn(MAX_DAYS_AHEAD);

  // mức kín chỗ từng ngày trong tháng đang xem
  useEffect(() => {
    if (!branchId) return;
    let off = false;
    const grid = monthGrid(ym);
    const from = grid[0][0].date < minDay ? minDay : grid[0][0].date;
    const lastCell = grid[grid.length - 1][6].date;
    const to = lastCell > maxDay ? maxDay : lastCell;
    if (from > to) {
      setMonthLoad(new Map());
      return;
    }
    supabase.rpc("branch_month_load", { p_branch: branchId, p_from: from, p_to: to }).then(({ data }) => {
      if (off) return;
      const m = new Map<string, { full: number; slots: number }>();
      for (const r of (data ?? []) as { day: string; full_slots: number; slots: number }[]) m.set(r.day, { full: r.full_slots, slots: r.slots });
      setMonthLoad(m);
    });
    return () => {
      off = true;
    };
  }, [branchId, ym, supabase, minDay, maxDay]);

  // giờ đã có khách trong ngày đang chọn
  useEffect(() => {
    if (!branchId || !date) return;
    let off = false;
    setDayBusy(null);
    supabase
      .rpc("branch_busy_intervals", {
        p_branch: branchId,
        p_from: vnDateTime(date, "00:00").toISOString(),
        p_to: vnDateTime(addDays(date, 1), "00:00").toISOString(),
      })
      .then(({ data }) => {
        if (!off) setDayBusy(toIntervals((data ?? []) as { start_at: string; end_at: string | null }[]));
      });
    return () => {
      off = true;
    };
  }, [branchId, date, supabase]);

  const branchServices = useMemo(
    () => services.filter((s) => s.branch_id === null || s.branch_id === branchId),
    [services, branchId],
  );
  const byId = useMemo(() => new Map(services.map((s) => [s.id, s])), [services]);
  const chosen = selected.map((id) => byId.get(id)).filter((s): s is Service => !!s);

  const grouped = useMemo(() => {
    const q = normalize(query.trim());
    const list = q
      ? branchServices.filter((s) => normalize(`${s.name} ${s.name_en ?? ""} ${s.description ?? ""}`).includes(q))
      : branchServices;
    return categories
      .map((c) => ({ cat: c, items: list.filter((s) => s.category_id === c.id) }))
      .filter((g) => g.items.length > 0);
  }, [branchServices, categories, query]);

  const totalMinutes = consult ? CONSULT_MINUTES : chosen.reduce((a, s) => a + s.duration_minutes, 0);
  const knownTotal = chosen.reduce((a, s) => a + (s.price ?? 0), 0);
  const hasQuote = chosen.some((s) => s.price === null);

  const earliest = Date.now() + MIN_LEAD_MINUTES * 60000;
  const durMs = (totalMinutes || 60) * 60000;
  /** số chỗ còn trống trong suốt thời gian làm nếu bắt đầu lúc t */
  const freeAt = (t: string) => {
    if (!dayBusy) return cap;
    const s = vnDateTime(date, t).getTime();
    return cap - peakLoad(dayBusy, s, s + durMs);
  };
  const slotOk = (t: string) => vnDateTime(date, t).getTime() >= earliest && freeAt(t) > 0;

  function changeBranch(id: string) {
    setBranchId(id);
    // bỏ các dịch vụ không có ở chi nhánh mới
    setSelected((prev) => prev.filter((sid) => {
      const s = byId.get(sid);
      return s && (s.branch_id === null || s.branch_id === id);
    }));
  }

  function toggle(id: string) {
    setError(null);
    setConsult(false);
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_SERVICES) {
        setError(`Mỗi lần đặt tối đa ${MAX_SERVICES} dịch vụ.`);
        return prev;
      }
      return [...prev, id];
    });
  }

  async function submit() {
    setError(null);
    if (!branchId) return setError("Vui lòng chọn chi nhánh.");
    if (!consult && chosen.length === 0)
      return setError("Vui lòng chọn dịch vụ, hoặc chọn “Chưa chọn liệu trình – Đặt lịch tư vấn”.");
    if (!time) return setError("Vui lòng chọn giờ.");
    const start = vnDateTime(date, time);
    if (start.getTime() < earliest) return setError(`Vui lòng chọn giờ cách hiện tại ít nhất ${MIN_LEAD_MINUTES} phút.`);

    setBusy(true);
    const supabase = createClient();
    const end = new Date(start.getTime() + totalMinutes * 60000);
    const { data: appt, error: e1 } = await supabase
      .from("appointments")
      .insert({
        customer_id: customerId,
        branch_id: branchId,
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        status: "pending",
        source: "online",
        note: note.trim() || null,
        is_consultation: consult,
      })
      .select("id")
      .single();
    if (e1 || !appt) {
      setBusy(false);
      return setError(vnError(e1?.message));
    }

    if (consult) {
      setBusy(false);
      setDone({ start: start.toISOString() });
      return;
    }

    let cursor = start.getTime();
    const rows = chosen.map((s) => {
      const row = {
        appointment_id: appt.id,
        service_id: s.id,
        start_at: new Date(cursor).toISOString(),
        end_at: new Date(cursor + s.duration_minutes * 60000).toISOString(),
      };
      cursor += s.duration_minutes * 60000;
      return row;
    });
    const { error: e2 } = await supabase.from("appointment_services").insert(rows);
    if (e2) {
      // không lưu được dịch vụ -> huỷ lịch vừa tạo để không bị lịch rỗng
      await supabase.from("appointments").update({ status: "cancelled" }).eq("id", appt.id);
      setBusy(false);
      return setError(vnError(e2.message));
    }
    setBusy(false);
    setDone({ start: start.toISOString() });
  }

  if (done) {
    const branch = branches.find((b) => b.id === branchId);
    return (
      <div className="card text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[#D6EDD8] text-2xl text-[#22612A]">✓</div>
        <h1 className="text-xl font-bold text-navy">{consult ? "Đã gửi yêu cầu đặt lịch tư vấn" : "Đã gửi yêu cầu đặt lịch"}</h1>
        <p className="mt-2 text-sm text-ink/80">
          {formatTime(done.start)} · {formatDate(done.start)}
          <br />
          {branch?.name} – {branch?.address}
        </p>
        <p className="mt-3 text-sm text-ink/70">Moana sẽ liên hệ xác nhận lịch với bạn sớm nhất.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/tai-khoan" className="btn-primary">Xem lịch của tôi</Link>
          <button
            className="btn-outline"
            onClick={() => {
              setDone(null);
              setSelected([]);
              setConsult(false);
              setTime("");
              setNote("");
            }}
          >
            Đặt thêm lịch
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-28">
      <div>
        <h1 className="text-2xl font-bold text-navy">Đặt lịch</h1>
        <p className="text-sm text-ink/70">Xin chào {customerName}, chọn chi nhánh, dịch vụ và giờ bạn muốn đến.</p>
      </div>

      {/* 1. Chi nhánh */}
      <section className="card">
        <h2 className="mb-3 font-semibold text-navy">1. Chi nhánh</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {branches.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => changeBranch(b.id)}
              className={`rounded-xl border p-3 text-left transition ${
                branchId === b.id ? "border-navy bg-navy text-white" : "border-beige-dark bg-cream hover:border-navy"
              }`}
            >
              <p className="font-semibold">{b.name}</p>
              <p className={`text-xs ${branchId === b.id ? "text-beige" : "text-ink/60"}`}>{b.address}</p>
            </button>
          ))}
        </div>
      </section>

      {/* 2. Dịch vụ */}
      <section className="card">
        <h2 className="mb-3 font-semibold text-navy">2. Dịch vụ <span className="font-normal text-ink/50">(tối đa {MAX_SERVICES})</span></h2>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setConsult((v) => !v);
            setSelected([]);
          }}
          className={`mb-3 flex w-full items-start gap-3 rounded-xl border p-3 text-left transition ${
            consult ? "border-navy bg-navy text-white" : "border-beige-dark bg-cream hover:border-navy"
          }`}
        >
          <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${consult ? "border-white bg-white text-navy" : "border-beige-dark bg-white"}`}>
            {consult ? "✓" : ""}
          </span>
          <span>
            <b className="block">Chưa chọn liệu trình – Đặt lịch tư vấn</b>
            <span className={`text-xs ${consult ? "text-beige" : "text-ink/60"}`}>
              Chuyên viên Moana soi da và tư vấn liệu trình phù hợp khi bạn đến spa (giữ chỗ khoảng {CONSULT_MINUTES} phút).
            </span>
          </span>
        </button>
        {!consult && <p className="mb-2 text-xs text-ink/50">Hoặc chọn dịch vụ bạn muốn làm:</p>}
        {!consult && chosen.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {chosen.map((s) => (
              <button key={s.id} type="button" onClick={() => toggle(s.id)} className="rounded-full bg-navy px-3 py-1 text-xs text-white">
                {s.name} ✕
              </button>
            ))}
          </div>
        )}
        {!consult && (<>
        <input
          className="input mb-3"
          placeholder="Tìm dịch vụ (vd: peel, mụn, cấp ẩm…)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="divide-y divide-beige-dark/60 overflow-hidden rounded-xl border border-beige-dark/70">
          {grouped.map(({ cat, items }) => {
            const open = query.trim() !== "" || openCat === cat.id;
            const count = items.filter((s) => selected.includes(s.id)).length;
            return (
              <div key={cat.id}>
                <button
                  type="button"
                  onClick={() => setOpenCat(open && openCat === cat.id ? null : cat.id)}
                  className="flex w-full items-center justify-between bg-cream px-4 py-3 text-left text-sm font-semibold text-navy"
                >
                  <span>
                    {cat.name} {count > 0 && <span className="ml-1 rounded-full bg-navy px-2 text-xs text-white">{count}</span>}
                  </span>
                  <span className="text-ink/40">{open ? "−" : "+"}</span>
                </button>
                {open && (
                  <ul>
                    {items.map((s) => {
                      const on = selected.includes(s.id);
                      return (
                        <li key={s.id}>
                          <button
                            type="button"
                            onClick={() => toggle(s.id)}
                            className={`flex w-full items-start gap-3 px-4 py-3 text-left transition ${on ? "bg-beige" : "bg-white hover:bg-cream"}`}
                          >
                            <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs ${on ? "border-navy bg-navy text-white" : "border-beige-dark"}`}>
                              {on ? "✓" : ""}
                            </span>
                            <span className="flex-1">
                              <span className="block text-sm font-medium">{s.name}</span>
                              {s.name_en && <span className="block text-[11px] uppercase tracking-wide text-ink/50">{s.name_en}</span>}
                            </span>
                            <span className="shrink-0 text-right text-sm font-semibold text-navy">{formatVnd(s.price)}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
          {grouped.length === 0 && <p className="p-4 text-sm text-ink/60">Không tìm thấy dịch vụ phù hợp.</p>}
        </div>
        </>)}
      </section>

      {/* 3. Ngày giờ */}
      <section className="card">
        <h2 className="mb-3 font-semibold text-navy">3. Ngày và giờ</h2>
        <div className="mb-2 flex items-center justify-between">
          <button
            type="button"
            className="btn-ghost px-3 py-1.5"
            disabled={ym <= monthOf(minDay)}
            onClick={() => setYm(shiftMonth(ym, -1))}
            aria-label="Tháng trước"
          >
            ‹
          </button>
          <p className="font-bold text-navy">{monthLabel(ym)}</p>
          <button
            type="button"
            className="btn-ghost px-3 py-1.5"
            disabled={ym >= monthOf(maxDay)}
            onClick={() => setYm(shiftMonth(ym, 1))}
            aria-label="Tháng sau"
          >
            ›
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-ink/50">
          {WEEKDAYS.map((w) => <div key={w} className={w === "CN" ? "text-[#8A2323]" : ""}>{w}</div>)}
        </div>
        <div className="mb-4 mt-1 grid grid-cols-7 gap-1">
          {monthGrid(ym).flat().map((g) => {
            const out = g.date < minDay || g.date > maxDay;
            const ld = monthLoad.get(g.date);
            const full = !!ld && ld.full >= ld.slots;
            const busyDay = !!ld && ld.full > 0 && !full;
            const sel = g.date === date;
            return (
              <button
                key={g.date}
                type="button"
                disabled={out || full}
                onClick={() => {
                  setDate(g.date);
                  setTime("");
                }}
                className={`flex aspect-square flex-col items-center justify-center rounded-lg text-sm transition sm:aspect-auto sm:h-14 ${
                  !g.inMonth ? "opacity-40" : ""
                } ${
                  sel
                    ? "bg-navy font-bold text-white"
                    : out
                      ? "cursor-not-allowed text-ink/25"
                      : full
                        ? "cursor-not-allowed bg-[#FCE4E4] text-[#8A2323]/60"
                        : busyDay
                          ? "bg-[#F3ECE1] hover:ring-2 hover:ring-navy"
                          : "bg-cream hover:ring-2 hover:ring-navy"
                }`}
              >
                <span className={g.date === minDay && !sel ? "font-bold text-navy underline" : ""}>{Number(g.date.slice(8))}</span>
                {!out && full && <span className="text-[9px] leading-none">Kín</span>}
                {!out && busyDay && !sel && <span className="text-[9px] leading-none text-[#6E5A3E]">Đông</span>}
              </button>
            );
          })}
        </div>
        <p className="mb-2 text-sm font-semibold capitalize text-navy">{formatDate(vnDateTime(date, "12:00").toISOString())}</p>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {SLOTS.map((t) => {
            const late = vnDateTime(date, t).getTime() < earliest;
            const free = freeAt(t);
            const ok = date !== "" && !late && free > 0;
            return (
              <button
                key={t}
                type="button"
                disabled={!ok}
                onClick={() => setTime(t)}
                className={`flex flex-col items-center rounded-lg border py-1.5 text-sm transition ${
                  time === t
                    ? "border-navy bg-navy text-white"
                    : ok
                      ? "border-beige-dark bg-white hover:border-navy"
                      : "cursor-not-allowed border-transparent bg-cream text-ink/30"
                }`}
              >
                <span className={late ? "line-through" : ""}>{t}</span>
                {!late && dayBusy && (
                  <span className={`text-[10px] leading-tight ${time === t ? "text-beige" : free <= 0 ? "text-[#8A2323]/70" : free === 1 ? "text-[#7A5600]" : "text-ink/40"}`}>
                    {free <= 0 ? "Hết chỗ" : free === 1 ? "Còn 1 chỗ" : "Còn chỗ"}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {date !== "" && dayBusy && SLOTS.every((t) => !slotOk(t)) && (
          <p className="mt-2 text-sm text-ink/60">Ngày này đã hết giờ nhận đặt online, vui lòng chọn ngày khác.</p>
        )}
        {(consult || chosen.length > 0) && (
          <p className="mt-2 text-xs text-ink/50">Giờ còn chỗ đã tính theo thời gian làm {formatDuration(totalMinutes)}.</p>
        )}
      </section>

      {/* 4. Ghi chú */}
      <section className="card">
        <h2 className="mb-3 font-semibold text-navy">4. Ghi chú <span className="font-normal text-ink/50">(không bắt buộc)</span></h2>
        <textarea
          className="input min-h-24"
          placeholder="Tình trạng da, kỹ thuật viên mong muốn, đi cùng bạn bè…"
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
        />
      </section>

      {/* Thanh tóm tắt */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-beige-dark bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <div className="flex-1 text-sm">
            {consult ? (
              <>
                <b className="text-navy">Đặt lịch tư vấn</b>
                <br />
                <span className="text-ink/70">
                  Chọn liệu trình tại spa{time && ` · ${time} ${date.split("-").reverse().join("/")}`}
                </span>
              </>
            ) : chosen.length === 0 ? (
              <span className="text-ink/60">Chưa chọn dịch vụ</span>
            ) : (
              <>
                <b className="text-navy">
                  {chosen.length} dịch vụ · {formatDuration(totalMinutes)}
                </b>
                <br />
                <span className="text-ink/70">
                  Tạm tính {formatVnd(knownTotal)}
                  {hasQuote && " + báo giá tại spa"}
                  {time && ` · ${time} ${date.split("-").reverse().join("/")}`}
                </span>
              </>
            )}
            {error && <p className="mt-1 text-xs font-medium text-[#8A2323]">{error}</p>}
          </div>
          <button className="btn-primary px-6 py-3" disabled={busy} onClick={submit}>
            {busy ? "Đang gửi…" : "Đặt lịch"}
          </button>
        </div>
      </div>
    </div>
  );
}
