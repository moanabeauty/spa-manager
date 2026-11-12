"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { playChime, unlockChime } from "@/lib/chime";

type Toast = { id: string; title: string; body: string | null; url: string | null };

function setAppBadge(n: number) {
  const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try {
    if (n > 0) nav.setAppBadge?.(n).catch(() => {});
    else nav.clearAppBadge?.().catch(() => {});
  } catch {
    // máy không hỗ trợ số trên biểu tượng app
  }
}

/** Chuông thông báo trên thanh đầu trang: số chưa đọc, kêu "ting ting" + hiện khung báo khi có việc mới */
export default function NotificationBell({ userId, initialUnread }: { userId: string; initialUnread: number }) {
  const router = useRouter();
  const [unread, setUnread] = useState(initialUnread);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seen = useRef(new Set<string>());

  useEffect(() => setUnread(initialUnread), [initialUnread]);
  useEffect(() => setAppBadge(unread), [unread]);

  const show = useCallback((t: Toast, countIt: boolean) => {
    if (seen.current.has(t.id)) return; // cùng 1 thông báo đến từ 2 đường (realtime + đẩy) chỉ kêu 1 lần
    seen.current.add(t.id);
    playChime();
    if (countIt) setUnread((n) => n + 1);
    setToasts((list) => [t, ...list].slice(0, 3));
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== t.id)), 9000);
  }, []);

  // mở khoá âm thanh ở lần chạm đầu tiên (iPhone bắt buộc)
  useEffect(() => {
    const h = () => unlockChime();
    window.addEventListener("pointerdown", h, { once: true });
    window.addEventListener("keydown", h, { once: true });
    return () => {
      window.removeEventListener("pointerdown", h);
      window.removeEventListener("keydown", h);
    };
  }, []);

  // bấm vào thông báo trên điện thoại -> trang mở với ?tb=<mã> -> đánh dấu đã đọc
  useEffect(() => {
    const url = new URL(window.location.href);
    const tb = url.searchParams.get("tb");
    if (!tb) return;
    url.searchParams.delete("tb");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    createClient()
      .rpc("mark_notifications_read", { p_id: tb })
      .then(() => setUnread((n) => Math.max(0, n - 1)));
  }, []);

  // thông báo mới theo thời gian thực khi app đang mở
  useEffect(() => {
    const supabase = createClient();
    // Nhiều thông báo đến cùng lúc (VD lịch mới báo cho tất cả) -> gộp thành 1 lần tải lại sau 3 giây;
    // app đang ẩn thì đợi lúc mở lại mới tải (tránh mọi máy cùng tải lại trang một lúc)
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending = false;
    const softRefresh = () => {
      if (document.visibilityState !== "visible") {
        pending = true;
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 3000);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && pending) {
        pending = false;
        router.refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    const ch = supabase
      .channel(`tb-${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (p) => {
          const r = p.new as { id: string; title: string; body: string | null; url: string | null };
          show({ id: r.id, title: r.title, body: r.body, url: r.url }, true);
          softRefresh(); // cập nhật số việc chờ trên menu
        },
      )
      .subscribe();
    // thông báo đẩy đến khi app đang mở (dự phòng khi realtime mất kết nối)
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; data?: { id?: string; title?: string; body?: string; url?: string; badge?: number } };
      if (d?.type !== "moana-push" || !d.data?.id) return;
      show({ id: d.data.id, title: d.data.title ?? "Moana", body: d.data.body ?? null, url: d.data.url ?? null }, false);
      if (typeof d.data.badge === "number") setUnread(d.data.badge);
    };
    navigator.serviceWorker?.addEventListener("message", onMsg);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      supabase.removeChannel(ch);
      navigator.serviceWorker?.removeEventListener("message", onMsg);
    };
  }, [userId, show, router]);

  async function open(t: Toast) {
    setToasts((list) => list.filter((x) => x.id !== t.id));
    await createClient().rpc("mark_notifications_read", { p_id: t.id });
    setUnread((n) => Math.max(0, n - 1));
    router.push(t.url || "/quan-ly/thong-bao");
  }

  return (
    <>
      <Link href="/quan-ly/thong-bao" className="relative shrink-0 rounded-full px-2 py-1.5 text-lg leading-none hover:bg-beige" aria-label={`Thông báo${unread ? ` (${unread} chưa đọc)` : ""}`}>
        🔔
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-[#B3261E] px-1 text-center text-[11px] font-bold leading-[18px] text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Link>
      {toasts.length > 0 && (
        <div className="fixed inset-x-0 top-2 z-50 mx-auto flex w-full max-w-md flex-col gap-2 px-3 print:hidden">
          {toasts.map((t) => (
            <button
              key={t.id}
              onClick={() => open(t)}
              className="flex w-full items-start gap-3 rounded-2xl border border-gold/50 bg-white p-3 text-left shadow-lg"
            >
              <span className="text-xl">🔔</span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-navy">{t.title}</span>
                {t.body && <span className="mt-0.5 block text-sm text-ink/75">{t.body}</span>}
              </span>
              <span
                role="button"
                aria-label="Đóng"
                className="px-1 text-ink/40"
                onClick={(e) => {
                  e.stopPropagation();
                  setToasts((list) => list.filter((x) => x.id !== t.id));
                }}
              >
                ✕
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
