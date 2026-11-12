import Link from "next/link";

export type TileIcon = "calendar" | "check" | "money" | "phone" | "box" | "alert" | "clock" | "users" | "layers" | "inbox" | "empty";

const PATHS: Record<TileIcon, string> = {
  calendar: "M4 6.5A1.5 1.5 0 015.5 5h13A1.5 1.5 0 0120 6.5v12a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 18.5zM4 10h16M8.5 3v4M15.5 3v4",
  check: "M20 6L9 17l-5-5",
  money: "M3 7h18v10H3zM12 15a3 3 0 100-6 3 3 0 000 6zM6 10v.01M18 14v.01",
  phone: "M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2",
  box: "M3 7l9-4 9 4-9 4-9-4zM3 7v10l9 4 9-4V7M12 11v10",
  alert: "M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z",
  clock: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2",
  users: "M9 11a4 4 0 100-8 4 4 0 000 8zM2 21v-1a6 6 0 0112 0v1M16 3.5a4 4 0 010 7.5M22 21v-1a6 6 0 00-4-5.6",
  layers: "M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5",
  inbox: "M3 13l3-8h12l3 8M3 13v6h18v-6M3 13h5l1 3h6l1-3h5",
  empty: "M12 21a9 9 0 100-18 9 9 0 000 18zM5.6 5.6l12.8 12.8",
};

export function TileIconSvg({ name, className = "h-5 w-5" }: { name: TileIcon; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

/** "+12% so với hôm qua" – hôm qua bằng 0 thì không chia được */
export function Delta({ now, prev, label = "so với hôm qua" }: { now: number; prev: number; label?: string }) {
  if (prev === 0 && now === 0) return <span className="text-xs text-ink/45">Bằng {label.replace("so với ", "")}</span>;
  if (prev === 0)
    return (
      <span className="text-xs text-ink/55">
        <span className="chip bg-[#D6EDD8] px-2 text-[#22612A]">▲ mới</span> {label.replace("so với ", "")} chưa có
      </span>
    );
  const pct = Math.round(((now - prev) / prev) * 100);
  const up = pct > 0;
  const same = pct === 0;
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-xs text-ink/55">
      <span className={`chip px-2 ${same ? "bg-[#ECECEC] text-[#666]" : up ? "bg-[#D6EDD8] text-[#22612A]" : "bg-[#F6D5D5] text-[#8A2323]"}`}>
        {same ? "=" : up ? "▲" : "▼"} {Math.abs(pct)}%
      </span>
      {label}
    </span>
  );
}

type Tone = "default" | "navy" | "gold" | "alert";
const TONE: Record<Tone, { box: string; icon: string; value: string }> = {
  default: { box: "", icon: "bg-gold-soft text-brown", value: "text-navy" },
  navy: { box: "!bg-navy !border-navy text-white", icon: "bg-white/15 text-gold", value: "text-white" },
  gold: { box: "!border-gold/70 !bg-gold-soft", icon: "bg-gold/30 text-brown", value: "text-[#7A5600]" },
  alert: { box: "!border-[#E8A5A5] !bg-[#FCE4E4]", icon: "bg-white/70 text-[#8A2323]", value: "text-[#8A2323]" },
};

/** Ô số liệu bo góc: biểu tượng · tên · số lớn · dòng phụ (VD % so với hôm qua) */
export default function StatTile({
  label,
  value,
  icon,
  foot,
  tone = "default",
  href,
}: {
  label: string;
  value: React.ReactNode;
  icon: TileIcon;
  foot?: React.ReactNode;
  tone?: Tone;
  href?: string;
}) {
  const t = TONE[tone];
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className={`text-[13px] font-medium ${tone === "navy" ? "text-white/75" : "text-ink/60"}`}>{label}</p>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl ${t.icon}`}>
          <TileIconSvg name={icon} className="h-[18px] w-[18px]" />
        </span>
      </div>
      <p className={`mt-2 text-[1.6rem] font-bold leading-none tracking-tight tabular-nums sm:text-[1.85rem] ${t.value}`}>{value}</p>
      {foot && <div className={`mt-3 ${tone === "navy" ? "[&_*]:!text-white/80" : ""}`}>{foot}</div>}
    </>
  );
  const cls = `stat-tile block ${t.box} ${href ? "transition hover:-translate-y-0.5 hover:shadow-md" : ""}`;
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
