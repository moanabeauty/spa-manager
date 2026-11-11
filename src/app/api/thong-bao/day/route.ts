import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/config";
import { sendPush } from "@/lib/webpush";

export const runtime = "nodejs";

type Row = {
  nid: string;
  sub_endpoint: string;
  sub_p256dh: string;
  sub_auth: string;
  title: string;
  body: string | null;
  url: string | null;
  tag: string | null;
  unread: number;
};

// Cơ sở dữ liệu vừa tạo thông báo (khách đặt lịch, yêu cầu cần duyệt...) -> gọi vào đây -> đẩy lên điện thoại.
// Chỉ chạy khi có đúng mã bí mật PUSH_WEBHOOK_SECRET (Supabase giữ cùng mã trong private.push_config).
export async function POST(request: Request) {
  const secret = process.env.PUSH_WEBHOOK_SECRET;
  if (!secret || request.headers.get("x-push-secret") !== secret) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!process.env.VAPID_PRIVATE_KEY) return NextResponse.json({ sent: 0, reason: "Chưa cài khoá thông báo" });
  const { ids } = (await request.json().catch(() => ({}))) as { ids?: string[] };
  if (!ids?.length) return NextResponse.json({ sent: 0 });

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await supabase.rpc("push_dispatch", { p_ids: ids, p_secret: secret });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  let sent = 0;
  await Promise.all(
    ((data ?? []) as Row[]).map(async (r) => {
      try {
        const status = await sendPush(
          { endpoint: r.sub_endpoint, p256dh: r.sub_p256dh, auth: r.sub_auth },
          { id: r.nid, title: r.title, body: r.body ?? "", url: r.url ?? "/quan-ly", tag: r.tag ?? r.nid, badge: r.unread },
        );
        if (status >= 200 && status < 300) sent++;
        else if (status === 404 || status === 410) await supabase.rpc("push_drop", { p_endpoint: r.sub_endpoint, p_secret: secret });
      } catch {
        // bỏ qua thiết bị lỗi, vẫn gửi các thiết bị khác
      }
    }),
  );
  return NextResponse.json({ sent });
}
