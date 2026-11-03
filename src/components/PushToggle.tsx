"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { vnError } from "@/lib/format";

function keyBytes(base64url: string): ArrayBuffer {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buf;
}

type State = "loading" | "unsupported" | "ios-install" | "denied" | "off" | "on";

/** Bật / tắt thông báo trên điện thoại này (yêu cầu giảm giá...) */
export default function PushToggle({ publicKey, hideWhenOn }: { publicKey: string; hideWhenOn?: boolean }) {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        return setState(ios && !standalone ? "ios-install" : "unsupported");
      }
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.register("/sw.js");
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  async function enable() {
    setBusy(true);
    setMsg(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
      const j = sub.toJSON();
      const { error } = await createClient().rpc("save_push_subscription", {
        p_endpoint: j.endpoint,
        p_p256dh: j.keys?.p256dh,
        p_auth: j.keys?.auth,
        p_user_agent: navigator.userAgent,
      });
      if (error) throw new Error(vnError(error.message));
      setState("on");
      setMsg("Đã bật. Bấm “Gửi thử” để kiểm tra.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Không bật được thông báo");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    const reg = await navigator.serviceWorker.getRegistration("/sw.js");
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await createClient().from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      await sub.unsubscribe();
    }
    setBusy(false);
    setState("off");
    setMsg(null);
  }

  async function test() {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/thong-bao/thu", { method: "POST" });
    const j = (await res.json().catch(() => ({}))) as { sent?: number; error?: string };
    setBusy(false);
    setMsg(j.error ? j.error : j.sent ? "Đã gửi, xem thông báo trên máy." : "Chưa gửi được, thử tắt rồi bật lại.");
  }

  if (state === "loading") return null;
  if (hideWhenOn && (state === "on" || state === "unsupported") && !msg) return null;
  return (
    <div className="card flex flex-wrap items-center gap-2 p-3 text-sm print:hidden">
      <span className="text-lg">🔔</span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-navy">Báo lên điện thoại khi có yêu cầu giảm giá</p>
        {state === "on" && <p className="text-xs text-[#22612A]">Đang bật trên máy này.</p>}
        {state === "off" && <p className="text-xs text-ink/60">Bật trên từng điện thoại / máy tính muốn nhận.</p>}
        {state === "denied" && (
          <p className="text-xs text-[#8A2323]">Máy đang chặn thông báo của trang này. Vào Cài đặt trình duyệt → Thông báo → cho phép, rồi tải lại trang.</p>
        )}
        {state === "ios-install" && (
          <p className="text-xs text-ink/70">
            iPhone: mở trang này bằng Safari → bấm nút Chia sẻ → “Thêm vào MH chính”, rồi mở biểu tượng Moana trên màn hình chính và bấm
            bật thông báo ở đây.
          </p>
        )}
        {state === "unsupported" && <p className="text-xs text-ink/60">Trình duyệt này chưa hỗ trợ thông báo. Dùng Chrome (Android) hoặc Safari (iPhone).</p>}
        {msg && <p className="text-xs">{msg}</p>}
      </div>
      {state === "off" && <button className="btn-primary py-2" disabled={busy} onClick={enable}>Bật thông báo</button>}
      {state === "on" && (
        <>
          <button className="btn-outline py-2" disabled={busy} onClick={test}>Gửi thử</button>
          <button className="btn-ghost py-2" disabled={busy} onClick={disable}>Tắt</button>
        </>
      )}
    </div>
  );
}
