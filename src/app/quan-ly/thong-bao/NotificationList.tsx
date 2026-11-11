"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { playChime, unlockChime } from "@/lib/chime";

export type Noti = { id: string; kind: string; title: string; body: string | null; url: string | null; created_at: string; read_at: string | null };

const ICON: Record<string, string> = { booking: "📅", approval: "📝", result: "✅" };

function ago(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "vừa xong";
  if (m < 60) return `${m} phút trước`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} giờ trước`;
  return new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
}

export default function NotificationList({ items }: { items: Noti[] }) {
  const router = useRouter();
  const [list, setList] = useState(items);
  const unread = list.filter((n) => !n.read_at).length;

  async function readAll() {
    await createClient().rpc("mark_notifications_read", { p_id: null });
    setList((l) => l.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
    router.refresh();
  }

  async function open(n: Noti) {
    if (!n.read_at) await createClient().rpc("mark_notifications_read", { p_id: n.id });
    router.push(n.url || "/quan-ly");
  }

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 text-sm text-ink/70">{unread ? `${unread} thông báo chưa đọc` : "Đã đọc hết"}</p>
        <button
          className="btn-ghost py-1.5 text-sm"
          onClick={() => {
            unlockChime();
            playChime();
          }}
        >
          🔊 Nghe thử âm báo
        </button>
        {unread > 0 && (
          <button className="btn-outline py-1.5 text-sm" onClick={readAll}>
            Đánh dấu đã đọc hết
          </button>
        )}
      </div>
      {list.length === 0 && <p className="py-6 text-center text-sm text-ink/60">Chưa có thông báo nào.</p>}
      <ul className="divide-y divide-gold/20">
        {list.map((n) => (
          <li key={n.id}>
            <button onClick={() => open(n)} className={`flex w-full items-start gap-3 py-3 text-left ${n.read_at ? "opacity-60" : ""}`}>
              <span className="text-lg">{ICON[n.kind] ?? "🔔"}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  {!n.read_at && <span className="h-2 w-2 shrink-0 rounded-full bg-[#B3261E]" />}
                  <span className="font-semibold text-navy">{n.title}</span>
                </span>
                {n.body && <span className="mt-0.5 block text-sm text-ink/75">{n.body}</span>}
                <span className="mt-0.5 block text-xs text-ink/50">{ago(n.created_at)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
