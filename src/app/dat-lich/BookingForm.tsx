"use client";

import { useMemo, useState } from "react";
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

export type Branch = { id: string; name: string; address: string };
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
  const [query, setQuery] = useState("");
  const [openCat, setOpenCat] = useState<string | null>(null);
  const [date, setDate] = useState<string>(todayVn());
  const [time, setTime] = useState<string>("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ start: string } | null>(null);

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

  const totalMinutes = chosen.reduce((a, s) => a + s.duration_minutes, 0);
  const knownTotal = chosen.reduce((a, s) => a + (s.price ?? 0), 0);
  const hasQuote = chosen.some((s) => s.price === null);

  const earliest = Date.now() + MIN_LEAD_MINUTES * 60000;
  const slotOk = (t: string) => vnDateTime(date, t).getTime() >= earliest;

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
    if (chosen.length === 0) return setError("Vui lòng chọn ít nhất 1 dịch vụ.");
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
      })
      .select("id")
      .single();
    if (e1 || !appt) {
      setBusy(false);
      return setError(vnError(e1?.message));
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
        <h1 className="text-xl font-bold text-navy">Đã gửi yêu cầu đặt lịch</h1>
        <p className="mt-2 text-sm text-ink/80">
          {formatTime(done.start)} · {formatDate(done.start)}
          <br />
          {branch?.name} – {branch?.address}
        </p>
        <p className="mt-3 text-sm text-ink/70">Moana sẽ liên hệ xác nhận lịch với bạn sớm nhất.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/lich-hen" className="btn-primary">Xem lịch của tôi</Link>
          <button
            className="btn-outline"
            onClick={() => {
              setDone(null);
              setSelected([]);
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
        {chosen.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {chosen.map((s) => (
              <button key={s.id} type="button" onClick={() => toggle(s.id)} className="rounded-full bg-navy px-3 py-1 text-xs text-white">
                {s.name} ✕
              </button>
            ))}
          </div>
        )}
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
      </section>

      {/* 3. Ngày giờ */}
      <section className="card">
        <h2 className="mb-3 font-semibold text-navy">3. Ngày và giờ</h2>
        <input
          type="date"
          className="input mb-3"
          value={date}
          min={todayVn()}
          max={todayVn(MAX_DAYS_AHEAD)}
          onChange={(e) => {
            setDate(e.target.value);
            setTime("");
          }}
        />
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {SLOTS.map((t) => {
            const ok = date !== "" && slotOk(t);
            return (
              <button
                key={t}
                type="button"
                disabled={!ok}
                onClick={() => setTime(t)}
                className={`rounded-lg border py-2 text-sm transition ${
                  time === t
                    ? "border-navy bg-navy text-white"
                    : ok
                      ? "border-beige-dark bg-white hover:border-navy"
                      : "cursor-not-allowed border-transparent bg-cream text-ink/30 line-through"
                }`}
              >
                {t}
              </button>
            );
          })}
        </div>
        {date !== "" && SLOTS.every((t) => !slotOk(t)) && (
          <p className="mt-2 text-sm text-ink/60">Hôm nay đã hết giờ nhận đặt online, vui lòng chọn ngày khác.</p>
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
            {chosen.length === 0 ? (
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
