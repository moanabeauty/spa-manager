import Link from "next/link";
import { formatDate, formatTime } from "@/lib/format";
import MarkRead from "./MarkRead";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (table: string) => any };
type Note = { id: string; title: string; body: string | null; url: string | null; created_at: string; read_at: string | null };

/** Thông báo của chính người đang đăng nhập (đăng ký gói / thẻ thành công…) */
export default async function Notifications({ supabase, title = "Thông báo", limit = 5, onlyUnread }: { supabase: Db; title?: string; limit?: number; onlyUnread?: boolean }) {
  let q = supabase.from("notifications").select("id, title, body, url, created_at, read_at").order("created_at", { ascending: false }).limit(limit);
  if (onlyUnread) q = q.is("read_at", null);
  const { data } = await q;
  const list = (data ?? []) as Note[];
  if (list.length === 0) return null;
  const unread = list.filter((n) => !n.read_at).map((n) => n.id);
  return (
    <section className="card space-y-2 p-4 text-sm">
      <h2 className="flex items-center gap-2 font-semibold text-navy">
        🔔 {title}
        {unread.length > 0 && <span className="rounded-full bg-[#8A2323] px-2 text-xs text-white">{unread.length} mới</span>}
      </h2>
      <ul className="divide-y divide-beige">
        {list.map((n) => {
          const inner = (
            <>
              <p className={`font-medium ${n.read_at ? "text-ink/80" : "text-navy"}`}>
                {!n.read_at && <span className="mr-1 inline-block h-2 w-2 rounded-full bg-[#8A2323] align-middle" />}
                {n.title}
              </p>
              {n.body && <p className="text-xs text-ink/70">{n.body}</p>}
              <p className="text-[11px] text-ink/40">{formatTime(n.created_at)} · {formatDate(n.created_at)}</p>
            </>
          );
          return (
            <li key={n.id} className="py-2">
              {n.url ? <Link href={n.url} className="block hover:opacity-80">{inner}</Link> : inner}
            </li>
          );
        })}
      </ul>
      {unread.length > 0 && <MarkRead ids={unread} />}
    </section>
  );
}
