// Tiện ích lịch tháng + timeline trong ngày (theo giờ Việt Nam)
import { TZ_OFFSET } from "./config";

export const WEEKDAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
export const DEFAULT_CAPACITY = 4;

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-11-04" + n ngày */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** "2026-11" */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`;
}

export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `Tháng ${Number(m)} / ${y}`;
}

export type GridDay = { date: string; inMonth: boolean };

/** Lưới lịch tháng, tuần bắt đầu thứ Hai (5–6 hàng × 7 ngày) */
export function monthGrid(ym: string): GridDay[][] {
  const first = `${ym}-01`;
  const [y, m] = ym.split("-").map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // 0 = thứ Hai
  let cur = addDays(first, -dow);
  const weeks: GridDay[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: GridDay[] = [];
    for (let i = 0; i < 7; i++) {
      row.push({ date: cur, inMonth: monthOf(cur) === ym });
      cur = addDays(cur, 1);
    }
    weeks.push(row);
    if (monthOf(cur) !== ym && w >= 3) break;
  }
  return weeks;
}

export function vnTime(date: string, hhmm: string): number {
  return new Date(`${date}T${hhmm}:00${TZ_OFFSET}`).getTime();
}

/** Ngày (YYYY-MM-DD, giờ VN) của một thời điểm */
export function vnDayOf(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(iso));
}

export type Interval = { s: number; e: number };

export function toIntervals(rows: { start_at: string; end_at: string | null }[]): Interval[] {
  return rows.map((r) => {
    const s = new Date(r.start_at).getTime();
    return { s, e: r.end_at ? new Date(r.end_at).getTime() : s + 60 * 60000 };
  });
}

/** Số khách làm cùng lúc nhiều nhất trong [from, to) */
export function peakLoad(list: Interval[], from: number, to: number): number {
  const inside = list.filter((x) => x.s < to && x.e > from);
  const points = [from, ...inside.map((x) => x.s).filter((s) => s > from && s < to)];
  let peak = 0;
  for (const p of points) {
    const n = inside.filter((x) => x.s <= p && x.e > p).length;
    if (n > peak) peak = n;
  }
  return peak;
}

/** Các suất 30 phút nhận khách trong ngày (9:00 – 19:30) */
export function daySlots(): string[] {
  const out: string[] = [];
  for (let m = 9 * 60; m <= 19 * 60 + 30; m += 30) out.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
  return out;
}

/** Số suất 30 phút đã kín trong ngày */
export function fullSlots(list: Interval[], date: string, cap: number): number {
  return daySlots().filter((t) => {
    const s = vnTime(date, t);
    return list.filter((x) => x.s < s + 30 * 60000 && x.e > s).length >= cap;
  }).length;
}

/** Xếp lịch vào các cột (làn) không chồng nhau – dùng cho timeline */
export function assignLanes<T extends Interval>(items: T[]): { item: T; lane: number }[] {
  const sorted = [...items].sort((a, b) => a.s - b.s || b.e - a.e);
  const laneEnds: number[] = [];
  return sorted.map((item) => {
    let lane = laneEnds.findIndex((end) => end <= item.s);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.e);
    } else laneEnds[lane] = item.e;
    return { item, lane };
  });
}

/** Mức kín chỗ của ngày: dùng tô màu ô lịch */
export function loadLevel(full: number, appts: number): "empty" | "light" | "busy" | "full" {
  if (appts === 0) return "empty";
  if (full >= daySlots().length) return "full";
  if (full > 0) return "busy";
  return "light";
}
