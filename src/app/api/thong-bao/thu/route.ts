import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendPush } from "@/lib/webpush";

export const runtime = "nodejs";

// Gửi thử 1 thông báo tới các thiết bị của chính người bấm
export async function POST() {
  if (!process.env.VAPID_PRIVATE_KEY) return NextResponse.json({ error: "Chưa cài khoá thông báo trên máy chủ" }, { status: 500 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  const { data } = await supabase.from("push_subscriptions").select("endpoint, p256dh, auth").eq("user_id", user.id);
  let sent = 0;
  for (const s of data ?? []) {
    try {
      const status = await sendPush(s, { title: "Moana: thông báo đã bật", body: "Khi có việc cần báo, điện thoại sẽ hiện như thế này.", url: "/" });
      if (status >= 200 && status < 300) sent++;
      else if (status === 404 || status === 410) await supabase.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
    } catch {
      // bỏ qua
    }
  }
  return NextResponse.json({ sent });
}
