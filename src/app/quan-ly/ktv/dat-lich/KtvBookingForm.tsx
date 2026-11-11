"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { normalizePhone, todayVn, vnDateTime, vnError } from "@/lib/format";
import { addDays, daySlots, peakLoad, toIntervals, type Interval } from "@/lib/calendar";
import { nowVnHHMM, weekdayShort, weekdayTiny } from "@/lib/ktv";
import ServicePicker, { type Pick, type PickService } from "../ServicePicker";

type Found = { id: string; code: string | null; full_name: string; packages_left: number | null; card_balance: number | null };
const DAYS = 14;

export default function KtvBookingForm({
  branchId,
  branchName,
  capacity,
  services,
  inKtvApp = true,
}: {
  branchId: string;
  branchName: string;
  capacity: number;
  services: PickService[];
  /** true = app KTV (thanh 5 tab dưới đáy); false = NV Kho / nhân viên khác dùng menu chung */
  inKtvApp?: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  // khách
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found[] | null>(null);
  const [customer, setCustomer] = useState<Found | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  // dịch vụ
  const [mode, setMode] = useState<"service" | "consult">("service");
  const [pick, setPick] = useState<Pick | null>(null);
  // ngày giờ
  const [date, setDate] = useState(todayVn());
  const [time, setTime] = useState("");
  const [busy, setBusy] = useState<Interval[] | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // tìm khách theo tên / mã KH / SĐT đầy đủ (KTV không thấy SĐT)
  useEffect(() => {
    if (customer || isNew) return;
    const t = q.trim();
    if (t.length < 2) return setFound(null);
    let off = false;
    const h = setTimeout(async () => {
      const { data } = await supabase.rpc("search_customers", { p_q: t, p_limit: 8 });
      if (!off) setFound((data ?? []) as Found[]);
    }, 300);
    return () => {
      off = true;
      clearTimeout(h);
    };
  }, [q, customer, isNew, supabase]);

  // khung giờ đã có khách trong ngày (không kèm tên / KTV)
  useEffect(() => {
    let off = false;
    setBusy(null);
    const from = vnDateTime(date, "00:00").toISOString();
    const to = vnDateTime(addDays(date, 1), "00:00").toISOString();
    supabase.rpc("branch_busy_intervals", { p_branch: branchId, p_from: from, p_to: to }).then(({ data }) => {
      if (!off) setBusy(toIntervals((data ?? []) as { start_at: string; end_at: string | null }[]));
    });
    return () => {
      off = true;
    };
  }, [date, branchId, supabase]);

  const minutes = mode === "consult" ? 60 : pick?.minutes ?? 60;
  const today = todayVn();
  const nowHM = nowVnHHMM();
  const slots = daySlots().map((t) => {
    const s = vnDateTime(date, t).getTime();
    const past = date === today && t <= nowHM;
    const full = busy ? peakLoad(busy, s, s + minutes * 60000) >= capacity : false;
    return { t, past, full };
  });
  useEffect(() => {
    if (time && slots.find((s) => s.t === time && (s.full || s.past))) setTime("");
  }, [slots, time]);

  const days = Array.from({ length: DAYS }, (_, i) => addDays(today, i));
  const when = time ? `${time} · ${weekdayShort(date)}` : "";
  const cta = mode === "consult" ? `Đặt hẹn tư vấn${when ? ` ${when}` : ""}` : `Đặt lịch${when ? ` ${when}` : ""}`;

  async function submit() {
    setError(null);
    if (!customer && !isNew) return setError("Vui lòng chọn khách hàng.");
    const phone = normalizePhone(newPhone);
    if (isNew && !newName.trim()) return setError("Khách mới: vui lòng nhập tên khách.");
    if (isNew && phone && (phone.length < 9 || phone.length > 11)) return setError("Số điện thoại phải có 9–11 số – hoặc để trống.");
    if (mode === "service" && !pick) return setError("Vui lòng chọn liệu trình, hoặc chọn Hẹn tư vấn.");
    if (!time) return setError("Vui lòng chọn khung giờ còn trống.");
    setSaving(true);
    const { error: e } = await supabase.rpc("ktv_book", {
      p_branch_id: branchId,
      p_start_at: vnDateTime(date, time).toISOString(),
      p_customer_id: customer?.id ?? null,
      p_customer_name: customer ? null : newName.trim(),
      p_customer_phone: customer || !phone ? null : phone,
      p_service_id: mode === "service" ? pick!.serviceId : null,
      p_package_item_id: mode === "service" ? pick!.itemId : null,
      p_note: note.trim() || null,
    });
    setSaving(false);
    if (e) return setError(vnError(e.message));
    setDone(`${mode === "consult" ? "Đã đặt hẹn tư vấn" : `Đã đặt ${pick!.label}`} cho ${customer?.full_name ?? newName.trim()} · ${when}`);
  }

  function reset() {
    setDone(null);
    setQ("");
    setFound(null);
    setCustomer(null);
    setIsNew(false);
    setNewName("");
    setNewPhone("");
    setPick(null);
    setTime("");
    setNote("");
    setMode("service");
  }

  if (done) {
    return (
      <div className="card mt-2 text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[#D6EDD8] text-2xl text-[#22612A]">✓</div>
        <p className="font-semibold text-navy">{done}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <Link href="/quan-ly" className="btn-primary">{inKtvApp ? "Về Hôm nay" : "Về Tổng quan"}</Link>
          <button className="btn-outline" onClick={reset}>Đặt lịch khác</button>
        </div>
      </div>
    );
  }

  const chip = (on: boolean) =>
    `rounded-xl px-3.5 py-3 text-left text-sm ${on ? "bg-navy text-white" : "bg-white ring-1 ring-beige-dark"}`;

  return (
    <div className="-mx-4 -mt-6 pb-36">
      <div className="bg-navy px-5 pb-4 pt-5 text-white">
        <h1 className="text-xl font-bold">Đặt lịch cho khách</h1>
        <p className="text-[13px] text-[#C9CADB]">Chi nhánh {branchName.replace(/^Moana\s*/i, "")}</p>
      </div>

      <div className="space-y-4 px-4 pt-4">
        {/* Khách hàng */}
        <section className="space-y-1.5">
          <label htmlFor="kh" className="text-[13px] font-semibold">Khách hàng</label>
          {customer ? (
            <div className="flex items-center justify-between rounded-xl bg-white px-3.5 py-3 ring-2 ring-navy">
              <span>
                <b className="block text-[15px]">{customer.full_name}</b>
                <span className="text-xs text-[#646464]">
                  {[customer.code, customer.packages_left ? `combo còn ${customer.packages_left} buổi` : "", Number(customer.card_balance) > 0 ? "có thẻ" : ""].filter(Boolean).join(" · ")}
                </span>
              </span>
              <button className="text-sm font-semibold text-navy underline" onClick={() => { setCustomer(null); setPick(null); }}>Đổi</button>
            </div>
          ) : isNew ? (
            <div className="space-y-2 rounded-xl bg-white p-3 ring-1 ring-beige-dark">
              <p className="text-xs text-[#646464]">Khách mới: chỉ cần tên – số điện thoại có thể để trống</p>
              <input className="input py-2.5" placeholder="Tên khách *" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <input className="input py-2.5" placeholder="Số điện thoại (có thể để trống)" inputMode="tel" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
              <button className="text-sm font-semibold text-navy underline" onClick={() => setIsNew(false)}>Tìm khách cũ</button>
            </div>
          ) : (
            <>
              <input
                id="kh"
                className="input py-3"
                placeholder="Tên, mã KH hoặc SĐT đầy đủ"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              {found && (
                <ul className="divide-y divide-beige overflow-hidden rounded-xl bg-white ring-1 ring-beige-dark">
                  {found.map((c) => (
                    <li key={c.id}>
                      <button className="w-full px-3.5 py-2.5 text-left text-sm hover:bg-cream" onClick={() => setCustomer(c)}>
                        <b>{c.full_name}</b> <span className="text-xs text-[#646464]">{c.code}</span>
                      </button>
                    </li>
                  ))}
                  {found.length === 0 && <li className="px-3.5 py-2.5 text-sm text-[#646464]">Không thấy khách.</li>}
                </ul>
              )}
              <button className="text-sm font-semibold text-navy underline" onClick={() => { setIsNew(true); setNewName(q.match(/\d/) ? "" : q); setNewPhone(q.match(/\d{9,}/) ? q : ""); }}>
                + Khách mới
              </button>
            </>
          )}
        </section>

        {/* Dịch vụ */}
        <section className="space-y-2">
          <p className="text-[13px] font-semibold">Dịch vụ</p>
          <div className="grid grid-cols-2 gap-2">
            <button className={chip(mode === "consult")} onClick={() => setMode("consult")}>
              <b className="block">Chưa chọn liệu trình – Hẹn tư vấn</b>
              <span className={`text-xs ${mode === "consult" ? "text-white/80" : "text-[#646464]"}`}>Khách đến mới chọn</span>
            </button>
            <button className={chip(mode === "service")} onClick={() => setMode("service")}>
              <b className="block">Chọn liệu trình</b>
              <span className={`text-xs ${mode === "service" ? "text-white/80" : "text-[#646464]"}`}>Combo khách đang có hiện trước</span>
            </button>
          </div>
          {mode === "service" && (
            <ServicePicker customerId={customer?.id ?? null} branchId={branchId} services={services} value={pick} onChange={setPick} />
          )}
          {mode === "service" && pick && (
            <p className="text-xs text-[#646464]">
              Đã chọn: <b className="text-ink">{pick.label}</b> · {pick.minutes} phút{pick.itemId ? " · trừ buổi combo khi hoàn thành" : ""}
            </p>
          )}
        </section>

        {/* Ngày */}
        <section className="space-y-2">
          <p className="text-[13px] font-semibold">Ngày</p>
          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
            {days.map((d) => {
              const on = d === date;
              return (
                <button
                  key={d}
                  onClick={() => { setDate(d); setTime(""); }}
                  className={`min-h-14 w-14 shrink-0 rounded-xl text-xs ${on ? "bg-navy text-white" : "bg-white text-black ring-1 ring-beige-dark"}`}
                >
                  {d === today ? "Nay" : weekdayTiny(d)}
                  <b className="block text-base">{d.slice(8, 10)}</b>
                </button>
              );
            })}
          </div>
        </section>

        {/* Khung giờ */}
        <section className="space-y-2">
          <div className="flex items-baseline justify-between">
            <p className="text-[13px] font-semibold">Khung giờ còn trống</p>
            <p className="text-xs text-[#646464]">Tối đa {capacity} khách / khung</p>
          </div>
          {!busy ? (
            <p className="text-sm text-[#646464]">Đang tải…</p>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {slots.map((s) => {
                const off = s.full || s.past;
                const on = s.t === time;
                return (
                  <button
                    key={s.t}
                    disabled={off}
                    onClick={() => setTime(s.t)}
                    className={`min-h-11 rounded-[10px] text-sm ${
                      on
                        ? "bg-brown font-bold text-black"
                        : off
                          ? `bg-[#EFECE6] text-[#8A8F94] ring-1 ring-[#E6DDCC] ${s.full ? "line-through" : ""}`
                          : "bg-white text-black ring-1 ring-beige-dark"
                    }`}
                  >
                    {s.t}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="space-y-1.5">
          <label htmlFor="gc" className="text-[13px] font-semibold">Ghi chú (không bắt buộc)</label>
          <textarea id="gc" className="input min-h-16 py-2 text-sm" value={note} onChange={(e) => setNote(e.target.value)} />
        </section>
      </div>

      <div className={`fixed inset-x-0 z-20 ${inKtvApp ? "bottom-[68px]" : "bottom-[var(--bottom-nav-h)]"}`}>
      <div className="border-t border-[#E6DDCC] bg-white px-4 py-3">
        <div className="mx-auto max-w-3xl space-y-1.5">
          {error && <p className="text-center text-xs text-[#B3261E]">{error}</p>}
          <button className="min-h-[52px] w-full rounded-[14px] bg-navy text-base font-semibold text-white disabled:opacity-50" disabled={saving} onClick={submit}>
            {saving ? "Đang đặt…" : cta}
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}
