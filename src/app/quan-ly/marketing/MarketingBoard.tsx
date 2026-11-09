"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatTime } from "@/lib/format";
import { vnDayOf } from "@/lib/calendar";
import {
  CHANNELS, FORMATS, PLAN_KIND, PLAN_STATUS, POST_STATUS, POST_STATUS_ORDER,
  channelOf, dayLabel, isLate, isLatePublish, lastDay, personName,
  type MkPerson, type MkPlan, type MkPost,
} from "@/lib/marketing";

const COL = 30; // độ rộng 1 ngày trên timeline (px)
const LEFT = 190; // cột tên bài

type Props = {
  month: string; today: string; me: string; isOwner: boolean;
  people: MkPerson[]; posts: MkPost[]; plans: MkPlan[]; inbox: MkPost[];
};

export default function MarketingBoard({ month, today, me, isOwner, people, posts, plans, inbox }: Props) {
  const [view, setView] = useState<"timeline" | "list">("timeline");
  const [pic, setPic] = useState<string>(""); // "" = tất cả
  const [status, setStatus] = useState<string>(""); // "" = tất cả, "open" = chưa đăng
  const [channel, setChannel] = useState<string>("");

  const days = useMemo(() => {
    const n = Number(lastDay(month).slice(8));
    return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
  }, [month]);

  const shown = posts.filter(
    (p) =>
      (!pic || p.pic_id === pic) &&
      (!status || (status === "open" ? !["published", "cancelled"].includes(p.status) : p.status === status)) &&
      (!channel || p.channels.includes(channel)),
  );
  const scheduled = shown.filter((p) => p.publish_date || p.due_date);
  const unscheduled = shown.filter((p) => !p.publish_date && !p.due_date);
  const shownPlans = plans.filter((p) => !pic || p.pic_id === pic);

  const counts = POST_STATUS_ORDER.map((s) => ({ s, n: posts.filter((p) => p.status === s).length })).filter((x) => x.n > 0);
  const late = posts.filter((p) => isLate(p, today) || isLatePublish(p, today)).length;

  return (
    <div className="space-y-4">
      {inbox.length > 0 && (
        <div className={`card border-l-4 p-0 ${isOwner ? "border-l-[#E0A526]" : "border-l-[#D9534F]"}`}>
          <p className="px-4 pt-3 text-sm font-semibold text-navy">
            {isOwner ? `Bài chờ bạn duyệt (${inbox.length})` : `Bài cần sửa theo góp ý (${inbox.length})`}
          </p>
          <ul className="divide-y divide-beige text-sm">
            {inbox.map((p) => (
              <li key={p.id}>
                <Link href={`/quan-ly/marketing/bai/${p.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 hover:bg-cream">
                  <span>
                    <span className="font-medium">{p.title}</span>
                    <span className="block text-xs text-ink/60">
                      {personName(people, p.pic_id)}
                      {p.publish_date && ` · đăng ${dayLabel(p.publish_date)}`}
                      {!isOwner && p.review_note && ` · Góp ý: ${p.review_note}`}
                    </span>
                  </span>
                  <span className="text-xs font-semibold text-navy">Mở ›</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* tóm tắt tháng */}
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-white px-3 py-1 font-semibold text-navy ring-1 ring-beige-dark">{posts.length} bài</span>
        {counts.map(({ s, n }) => (
          <button
            key={s}
            onClick={() => setStatus(status === s ? "" : s)}
            className={`rounded-full px-3 py-1 font-semibold ${POST_STATUS[s].c} ${status === s ? "ring-2 ring-navy" : ""}`}
          >
            {POST_STATUS[s].t}: {n}
          </button>
        ))}
        {late > 0 && <span className="rounded-full bg-[#B3261E] px-3 py-1 font-semibold text-white">Trễ hạn: {late}</span>}
        <span className="rounded-full bg-white px-3 py-1 font-semibold text-navy ring-1 ring-beige-dark">{plans.length} lịch quay · chụp · họp</span>
      </div>

      {/* bộ lọc */}
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <div className="flex rounded-full bg-cream p-1">
          {(["timeline", "list"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-full px-3 py-1 text-sm font-semibold ${view === v ? "bg-navy text-white" : "text-navy"}`}
            >
              {v === "timeline" ? "Timeline" : "Danh sách"}
            </button>
          ))}
        </div>
        <select className="input w-auto py-1.5 text-sm" value={pic} onChange={(e) => setPic(e.target.value)}>
          <option value="">Mọi người phụ trách</option>
          <option value={me}>Việc của tôi</option>
          {people.filter((p) => p.id !== me).map((p) => (
            <option key={p.id} value={p.id}>{p.full_name ?? "(chưa có tên)"}</option>
          ))}
        </select>
        <select className="input w-auto py-1.5 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Mọi trạng thái</option>
          <option value="open">Chưa đăng</option>
          {POST_STATUS_ORDER.map((s) => (
            <option key={s} value={s}>{POST_STATUS[s].t}</option>
          ))}
        </select>
        <select className="input w-auto py-1.5 text-sm" value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="">Mọi kênh</option>
          {CHANNELS.map((c) => (
            <option key={c.key} value={c.key}>{c.label}</option>
          ))}
        </select>
      </div>

      {view === "timeline" ? (
        <Timeline days={days} today={today} people={people} posts={scheduled} plans={shownPlans} />
      ) : (
        <PostList today={today} people={people} posts={scheduled} plans={shownPlans} />
      )}

      {unscheduled.length > 0 && (
        <div className="card p-0">
          <p className="px-4 pt-3 text-sm font-semibold text-navy">Chưa xếp ngày ({unscheduled.length})</p>
          <ul className="divide-y divide-beige">
            {unscheduled.map((p) => (
              <PostRow key={p.id} p={p} people={people} today={today} />
            ))}
          </ul>
        </div>
      )}

      {shown.length === 0 && shownPlans.length === 0 && (
        <p className="card text-center text-sm text-ink/60">
          Tháng này chưa có bài viết nào. Bấm <b>+ Bài viết</b> để lên lịch.
        </p>
      )}
    </div>
  );
}

function Channels({ list }: { list: string[] }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {list.map((k) => {
        const c = channelOf(k);
        return c ? (
          <span key={k} className={`rounded px-1.5 text-[10px] font-bold leading-4 ${c.color}`} title={c.label}>
            {c.short}
          </span>
        ) : null;
      })}
    </span>
  );
}

/** Timeline dạng Gantt: mỗi bài một hàng, ◆ = deadline nộp, ● = ngày đăng */
function Timeline({ days, today, people, posts, plans }: { days: string[]; today: string; people: MkPerson[]; posts: MkPost[]; plans: MkPlan[] }) {
  const first = days[0];
  const last = days[days.length - 1];
  const idx = (d: string) => Number(d.slice(8)) - 1;
  const width = days.length * COL;
  const weekend = days.filter((d) => {
    const w = new Date(`${d}T12:00:00+07:00`).getUTCDay();
    return w === 0 || w === 6;
  });
  const todayIn = today >= first && today <= last;

  const Stripes = () => (
    <>
      {weekend.map((d) => (
        <span key={d} className="absolute inset-y-0 bg-cream" style={{ left: idx(d) * COL, width: COL }} />
      ))}
      {todayIn && <span className="absolute inset-y-0 bg-[#FFE8BA]/60" style={{ left: idx(today) * COL, width: COL }} />}
    </>
  );

  return (
    <div className="card overflow-hidden p-0">
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-beige px-4 py-2 text-xs text-ink/70">
        <span><b className="text-brown">◆</b> Deadline nộp</span>
        <span><b className="text-navy">●</b> Ngày đăng</span>
        <span>🎬 Quay · 📷 Chụp · 💬 Họp</span>
        <span className="text-[#B3261E]">Chữ đỏ = trễ hạn</span>
      </div>
      <div className="overflow-x-auto">
        <div style={{ width: LEFT + width }} className="text-xs">
          {/* tiêu đề ngày */}
          <div className="flex border-b border-beige-dark/60">
            <div className="sticky left-0 z-10 shrink-0 bg-white px-3 py-2 font-semibold text-navy" style={{ width: LEFT }}>
              Bài viết · PIC
            </div>
            <div className="relative flex" style={{ width }}>
              {days.map((d) => {
                const w = new Date(`${d}T12:00:00+07:00`).getUTCDay();
                const isToday = d === today;
                return (
                  <div
                    key={d}
                    className={`flex flex-col items-center justify-center py-1 ${isToday ? "bg-navy font-bold text-white" : w === 0 || w === 6 ? "bg-cream text-brown" : "text-ink/70"}`}
                    style={{ width: COL }}
                  >
                    <span className="text-[9px] leading-3">{["CN", "T2", "T3", "T4", "T5", "T6", "T7"][w]}</span>
                    <span className="font-semibold leading-4">{Number(d.slice(8))}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {posts.map((p) => {
            const st = POST_STATUS[p.status] ?? POST_STATUS.idea;
            const due = p.due_date && p.due_date >= first && p.due_date <= last ? p.due_date : null;
            const pub = p.publish_date && p.publish_date >= first && p.publish_date <= last ? p.publish_date : null;
            // vạch nối deadline → ngày đăng (cắt theo tháng đang xem)
            const a = p.due_date ? (p.due_date < first ? first : p.due_date > last ? null : p.due_date) : null;
            const b = p.publish_date ? (p.publish_date > last ? last : p.publish_date < first ? null : p.publish_date) : null;
            const late = isLate(p, today) || isLatePublish(p, today);
            return (
              <Link key={p.id} href={`/quan-ly/marketing/bai/${p.id}`} className="group flex border-b border-beige last:border-0 hover:bg-cream/60">
                <div className="sticky left-0 z-10 shrink-0 bg-white px-3 py-1.5 group-hover:bg-cream" style={{ width: LEFT }}>
                  <span className={`block truncate font-medium ${late ? "text-[#B3261E]" : "text-ink"}`} title={p.title}>{p.title}</span>
                  <span className="flex items-center gap-1 truncate text-[11px] text-ink/60">
                    <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${st.bar}`} title={st.t} />
                    {personName(people, p.pic_id)}
                  </span>
                </div>
                <div className="relative" style={{ width }}>
                  <Stripes />
                  {a && b && a <= b && (
                    <span
                      className={`absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full opacity-50 ${st.bar}`}
                      style={{ left: idx(a) * COL + COL / 2, width: (idx(b) - idx(a)) * COL }}
                    />
                  )}
                  {due && (
                    <span
                      className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-sm leading-none text-brown"
                      style={{ left: idx(due) * COL + COL / 2 }}
                      title={`Deadline nộp ${dayLabel(due)}`}
                    >
                      ◆
                    </span>
                  )}
                  {pub && (
                    <span
                      className={`absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white ${st.bar}`}
                      style={{ left: idx(pub) * COL + COL / 2 }}
                      title={`Đăng ${dayLabel(pub)} · ${st.t}`}
                    />
                  )}
                </div>
              </Link>
            );
          })}

          {plans.length > 0 && (
            <div className="sticky left-0 border-y border-beige-dark/60 bg-beige/50 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-brown" style={{ width: LEFT + width }}>
              Quay · chụp · họp content
            </div>
          )}
          {plans.map((pl) => {
            const k = PLAN_KIND[pl.kind] ?? PLAN_KIND.other;
            const d = vnDayOf(pl.start_at);
            return (
              <Link key={pl.id} href={`/quan-ly/marketing/ke-hoach/${pl.id}`} className="group flex border-b border-beige last:border-0 hover:bg-cream/60">
                <div className="sticky left-0 z-10 shrink-0 bg-white px-3 py-1.5 group-hover:bg-cream" style={{ width: LEFT }}>
                  <span className={`block truncate font-medium ${pl.status === "cancelled" ? "text-ink/40 line-through" : ""}`} title={pl.title}>
                    {k.icon} {pl.title}
                  </span>
                  <span className="block truncate text-[11px] text-ink/60">
                    {formatTime(pl.start_at)} · {personName(people, pl.pic_id)}
                  </span>
                </div>
                <div className="relative" style={{ width }}>
                  <Stripes />
                  <span
                    className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-base leading-none"
                    style={{ left: idx(d) * COL + COL / 2 }}
                    title={`${k.t} ${dayLabel(d)} ${formatTime(pl.start_at)}`}
                  >
                    {k.icon}
                  </span>
                </div>
              </Link>
            );
          })}
          {posts.length === 0 && plans.length === 0 && (
            <p className="sticky left-0 px-4 py-6 text-sm text-ink/60" style={{ width: "min(100vw, 600px)" }}>Không có bài nào khớp bộ lọc.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function PostRow({ p, people, today }: { p: MkPost; people: MkPerson[]; today: string }) {
  const st = POST_STATUS[p.status] ?? POST_STATUS.idea;
  const lateDue = isLate(p, today);
  const latePub = isLatePublish(p, today);
  return (
    <li>
      <Link href={`/quan-ly/marketing/bai/${p.id}`} className="flex flex-wrap items-start justify-between gap-2 px-4 py-2.5 hover:bg-cream">
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-ink">{p.title}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink/60">
            <span>👤 {personName(people, p.pic_id)}</span>
            <span>{FORMATS[p.format] ?? p.format}</span>
            <Channels list={p.channels} />
          </span>
          <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs">
            <span className={lateDue ? "font-semibold text-[#B3261E]" : "text-ink/70"}>
              ◆ Nộp: {p.due_date ? dayLabel(p.due_date) : "—"}{lateDue && " (trễ)"}
            </span>
            <span className={latePub ? "font-semibold text-[#B3261E]" : "text-ink/70"}>
              ● Đăng: {p.publish_date ? dayLabel(p.publish_date) : "—"}{latePub && " (chưa đăng)"}
            </span>
          </span>
        </span>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${st.c}`}>{st.t}</span>
      </Link>
    </li>
  );
}

/** Danh sách theo ngày đăng (dễ xem trên điện thoại) */
function PostList({ today, people, posts, plans }: { today: string; people: MkPerson[]; posts: MkPost[]; plans: MkPlan[] }) {
  type Row = { date: string; posts: MkPost[]; plans: MkPlan[] };
  const map = new Map<string, Row>();
  const get = (d: string) => {
    if (!map.has(d)) map.set(d, { date: d, posts: [], plans: [] });
    return map.get(d)!;
  };
  posts.forEach((p) => get(p.publish_date ?? p.due_date!).posts.push(p));
  plans.forEach((pl) => get(vnDayOf(pl.start_at)).plans.push(pl));
  const rows = [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length === 0) return <p className="card text-center text-sm text-ink/60">Không có bài nào khớp bộ lọc.</p>;
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.date} className={`card p-0 ${r.date === today ? "ring-2 ring-navy" : ""}`}>
          <p className="border-b border-beige px-4 py-2 text-sm font-semibold capitalize text-navy">
            {dayLabel(r.date)}{r.date === today && " · hôm nay"}
          </p>
          <ul className="divide-y divide-beige">
            {r.plans.map((pl) => {
              const k = PLAN_KIND[pl.kind] ?? PLAN_KIND.other;
              const s = PLAN_STATUS[pl.status] ?? PLAN_STATUS.planned;
              return (
                <li key={pl.id}>
                  <Link href={`/quan-ly/marketing/ke-hoach/${pl.id}`} className="flex items-center justify-between gap-2 bg-beige/30 px-4 py-2 text-sm hover:bg-cream">
                    <span>
                      <span className="font-medium">{k.icon} {pl.title}</span>
                      <span className="block text-xs text-ink/60">
                        {k.t} · {formatTime(pl.start_at)}{pl.end_at && `–${formatTime(pl.end_at)}`}
                        {pl.location && ` · ${pl.location}`} · {personName(people, pl.pic_id)}
                      </span>
                    </span>
                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.c}`}>{s.t}</span>
                  </Link>
                </li>
              );
            })}
            {r.posts.map((p) => (
              <PostRow key={p.id} p={p} people={people} today={today} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
