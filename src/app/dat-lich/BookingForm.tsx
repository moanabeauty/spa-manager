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
import {
  bestPart,
  partLeft,
  partLeftText,
  partName,
  shortDmy,
  urgentParts,
  usageOf,
  type PackageOption,
} from "@/lib/packageBooking";

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

/** 1 dòng đặt: dịch vụ thường, hoặc trừ buổi trong gói (serviceId = null: KTV tư vấn chọn loại tại spa) */
type Pick = { key: number; serviceId: string | null; partId: string | null; staffChoose: boolean };

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
  customerName,
  branches,
  categories,
  services,
  packageOptions,
}: {
  customerId: string;
  customerName: string;
  branches: Branch[];
  categories: Category[];
  services: Service[];
  packageOptions: PackageOption[];
}) {
  const [branchId, setBranchId] = useState<string>(branches[0]?.id ?? "");
  const [picks, setPicks] = useState<Pick[]>([]);
  const [nextKey, setNextKey] = useState(1);
  const [consult, setConsult] = useState(false);
  const [openPart, setOpenPart] = useState<string | null>(null);
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
  const partById = useMemo(() => new Map(packageOptions.map((o) => [o.item_id, o])), [packageOptions]);
  const selected = picks.map((p) => p.serviceId).filter((x): x is string => !!x);
  const used = usageOf(picks);
  const urgent = urgentParts(packageOptions);

  const grouped = useMemo(() => {
    const q = normalize(query.trim());
    const list = q
      ? branchServices.filter((s) => normalize(`${s.name} ${s.name_en ?? ""} ${s.description ?? ""}`).includes(q))
      : branchServices;
    return categories
      .map((c) => ({ cat: c, items: list.filter((s) => s.category_id === c.id) }))
      .filter((g) => g.items.length > 0);
  }, [branchServices, categories, query]);

  const totalMinutes = picks.reduce((a, p) => a + (p.serviceId ? byId.get(p.serviceId)?.duration_minutes ?? 60 : 60), 0) || (consult ? 60 : 0);
  const paidPicks = picks.filter((p) => !p.partId && p.serviceId).map((p) => byId.get(p.serviceId!)).filter((s): s is Service => !!s);
  const knownTotal = paidPicks.reduce((a, s) => a + (s.price ?? 0), 0);
  const hasQuote = paidPicks.some((s) => s.price === null);
  const fromPackage = picks.filter((p) => p.partId).length;

  const earliest = Date.now() + MIN_LEAD_MINUTES * 60000;
  const slotOk = (t: string) => vnDateTime(date, t).getTime() >= earliest;

  function changeBranch(id: string) {
    setBranchId(id);
    // bỏ các dịch vụ không có ở chi nhánh mới
    setPicks((prev) =>
      prev.filter((p) => {
        if (!p.serviceId) return true;
        const s = byId.get(p.serviceId);
        return s && (s.branch_id === null || s.branch_id === id);
      }),
    );
  }

  function addPick(p: Omit<Pick, "key">) {
    setError(null);
    if (picks.length >= MAX_SERVICES) return setError(`Mỗi lần đặt tối đa ${MAX_SERVICES} dịch vụ.`);
    setPicks((prev) => [...prev, { ...p, key: nextKey }]);
    setNextKey((k) => k + 1);
  }

  // chọn dịch vụ trong menu: nếu gói của khách có dịch vụ này thì tự trừ buổi theo phương án có lợi nhất
  function toggle(id: string) {
    const existing = picks.find((p) => p.serviceId === id);
    if (existing) return setPicks((prev) => prev.filter((p) => p.key !== existing.key));
    const best = bestPart(packageOptions, id, used);
    addPick({ serviceId: id, partId: best?.item_id ?? null, staffChoose: false });
  }

  function usePart(o: PackageOption, serviceId: string | null) {
    setOpenPart(null);
    addPick({ serviceId, partId: o.item_id, staffChoose: serviceId === null });
  }

  function setPickPart(key: number, partId: string | null) {
    setPicks((prev) => prev.map((p) => (p.key === key ? { ...p, partId } : p)));
  }

  function pickLabel(p: Pick): string {
    if (p.serviceId) return byId.get(p.serviceId)?.name ?? "Dịch vụ";
    const o = p.partId ? partById.get(p.partId) : null;
    return o ? `${o.label} (KTV tư vấn chọn loại phù hợp)` : "Dịch vụ";
  }

  async function submit() {
    setError(null);
    if (!branchId) return setError("Vui lòng chọn chi nhánh.");
    if (picks.length === 0 && !consult) return setError("Vui lòng chọn ít nhất 1 dịch vụ, hoặc chọn “Chưa chọn dịch vụ – để Moana tư vấn”.");
    if (!time) return setError("Vui lòng chọn giờ.");
    const start = vnDateTime(date, time);
    if (start.getTime() < earliest) return setError(`Vui lòng chọn giờ cách hiện tại ít nhất ${MIN_LEAD_MINUTES} phút.`);

    setBusy(true);
    const { error: e } = await createClient().rpc("book_online", {
      p_branch_id: branchId,
      p_start_at: start.toISOString(),
      p_items: picks.map((p) => ({ service_id: p.serviceId, customer_package_item_id: p.partId, staff_choose: p.staffChoose })),
      p_note: note.trim() || null,
      p_consult: consult,
    });
    setBusy(false);
    if (e) return setError(vnError(e.message));
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
          <Link href="/tai-khoan" className="btn-primary">Xem lịch của tôi</Link>
          <button
            className="btn-outline"
            onClick={() => {
              setDone(null);
              setPicks([]);
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

      {/* Gói của khách */}
      {packageOptions.length > 0 && (
        <section className="card">
          <h2 className="font-semibold text-navy">Buổi còn trong gói của bạn</h2>
          <p className="mb-3 text-xs text-ink/60">Chọn để đặt lịch dùng buổi trong gói (không phải thanh toán thêm). Moana đã sắp xếp gói nên dùng trước lên đầu.</p>
          {urgent.length > 0 && (
            <p className="mb-3 rounded-lg bg-[#FFE8BA]/70 px-3 py-2 text-xs">
              ⏰ Sắp hết hạn: {urgent.map((o) => `${partName(o)} (${partLeftText(o)}, hạn ${shortDmy(o.expires_at!)})`).join(" · ")} – nên dùng trước nhé.
            </p>
          )}
          <ul className="space-y-2">
            {packageOptions.map((o) => {
              const left = partLeft(o, used.get(o.item_id) ?? 0);
              const visible = o.service_ids.map((id) => byId.get(id)).filter((x): x is Service => !!x && (x.branch_id === null || x.branch_id === branchId));
              const single = !o.staff_choice && visible.length === 1;
              return (
                <li key={o.item_id} className="rounded-xl border border-beige-dark/70 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{o.label}</p>
                      <p className="text-xs text-ink/60">
                        {o.package_name} · {partLeftText(o, used.get(o.item_id) ?? 0)}
                        {o.reserved > 0 && ` (${o.reserved} buổi đã đặt lịch)`}
                        {o.expires_at && ` · hạn ${shortDmy(o.expires_at)}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={left <= 0}
                      onClick={() => (single ? usePart(o, visible[0].id) : o.staff_choice || visible.length === 0 ? usePart(o, null) : setOpenPart(openPart === o.item_id ? null : o.item_id))}
                      className="btn-outline shrink-0 py-1.5 text-sm disabled:opacity-40"
                    >
                      {left <= 0 ? "Hết buổi" : "+ Đặt 1 buổi"}
                    </button>
                  </div>
                  {openPart === o.item_id && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {visible.map((v) => (
                        <button key={v.id} type="button" className="rounded-full bg-cream px-3 py-1 text-xs ring-1 ring-beige-dark hover:bg-beige" onClick={() => usePart(o, v.id)}>
                          {v.name}
                        </button>
                      ))}
                      <button type="button" className="rounded-full bg-white px-3 py-1 text-xs text-navy ring-1 ring-navy" onClick={() => usePart(o, null)}>
                        Để KTV tư vấn chọn
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* 2. Dịch vụ */}
      <section className="card">
        <h2 className="mb-3 font-semibold text-navy">2. Dịch vụ <span className="font-normal text-ink/50">(tối đa {MAX_SERVICES})</span></h2>

        <label className={`mb-3 flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${consult ? "border-navy bg-beige" : "border-beige-dark bg-cream"}`}>
          <input type="checkbox" className="mt-1" checked={consult} onChange={(e) => setConsult(e.target.checked)} />
          <span className="text-sm">
            <b>Chưa chọn dịch vụ – để Moana tư vấn</b>
            <span className="block text-xs text-ink/60">Bạn chỉ cần chọn giờ đến, quản lý sẽ soi da và tư vấn liệu trình phù hợp khi bạn tới spa.</span>
          </span>
        </label>

        {picks.length > 0 && (
          <ul className="mb-3 space-y-2">
            {picks.map((p, i) => {
              const others = usageOf(picks, i);
              const opts = p.serviceId
                ? packageOptions.filter((o) => o.service_ids.includes(p.serviceId!) && (o.item_id === p.partId || partLeft(o, others.get(o.item_id) ?? 0) > 0))
                : [];
              const part = p.partId ? partById.get(p.partId) : null;
              const svc = p.serviceId ? byId.get(p.serviceId) : null;
              return (
                <li key={p.key} className={`rounded-xl border p-3 text-sm ${part ? "border-[#22612A]/40 bg-[#D6EDD8]/40" : "border-beige-dark/70"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium">{pickLabel(p)}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className={part ? "font-semibold text-[#22612A]" : "text-navy"}>{part ? "Trừ buổi gói" : formatVnd(svc?.price)}</span>
                      <button type="button" className="text-[#8A2323]" aria-label="Bỏ" onClick={() => setPicks((prev) => prev.filter((x) => x.key !== p.key))}>✕</button>
                    </span>
                  </div>
                  {opts.length > 0 && (
                    <select
                      className="mt-2 w-full rounded-lg border border-beige-dark bg-white px-2 py-1.5 text-xs"
                      value={p.partId ?? ""}
                      onChange={(e) => setPickPart(p.key, e.target.value || null)}
                    >
                      {opts.map((o) => (
                        <option key={o.item_id} value={o.item_id}>
                          Trừ buổi: {partName(o)} ({partLeftText(o, others.get(o.item_id) ?? 0)}
                          {o.expires_at ? `, hạn ${shortDmy(o.expires_at)}` : ""})
                        </option>
                      ))}
                      <option value="">Không dùng gói – thanh toán tại spa ({formatVnd(svc?.price)})</option>
                    </select>
                  )}
                  {!p.serviceId && part && <p className="mt-1 text-xs text-ink/60">{part.package_name} · {partLeftText(part, others.get(part.item_id) ?? 0)}</p>}
                </li>
              );
            })}
          </ul>
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
            {picks.length === 0 ? (
              <span className="text-ink/60">{consult ? "Đặt lịch tư vấn tại spa" : "Chưa chọn dịch vụ"}</span>
            ) : (
              <>
                <b className="text-navy">
                  {picks.length} dịch vụ · {formatDuration(totalMinutes)}
                </b>
                <br />
                <span className="text-ink/70">
                  {fromPackage > 0 && `${fromPackage} trừ buổi gói · `}
                  {paidPicks.length > 0 ? `Tạm tính ${formatVnd(knownTotal)}` : "Không phải trả thêm"}
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
