import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendPush } from "@/lib/webpush";

export const runtime = "nodejs";

// Nhân viên vừa gửi yêu cầu giảm giá -> báo lên điện thoại của chủ spa.
// Cơ sở dữ liệu chỉ trả danh sách thiết bị nếu đúng người vừa gửi, yêu cầu còn chờ và chưa báo lần nào.
export async function POST(request: Request) {
  const { requestId } = (await request.json().catch(() => ({}))) as { requestId?: string };
  if (!requestId) return NextResponse.json({ error: "Thiếu mã yêu cầu" }, { status: 400 });
  if (!process.env.VAPID_PRIVATE_KEY) return NextResponse.json({ sent: 0, reason: "Chưa cài khoá thông báo" });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("discount_push_targets", { p_request: requestId });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const targets = (data ?? []) as { sub_endpoint: string; sub_p256dh: string; sub_auth: string; title: string; body: string }[];
  let sent = 0;
  await Promise.all(
    targets.map(async (t) => {
      try {
        const status = await sendPush(
          { endpoint: t.sub_endpoint, p256dh: t.sub_p256dh, auth: t.sub_auth },
          { title: t.title, body: t.body, url: "/quan-ly/duyet-giam-gia", tag: `giam-gia-${requestId}` },
        );
        if (status >= 200 && status < 300) sent++;
        else if (status === 404 || status === 410) await supabase.rpc("drop_push_subscription", { p_endpoint: t.sub_endpoint });
      } catch {
        // bỏ qua thiết bị lỗi, vẫn báo các thiết bị khác
      }
    }),
  );
  return NextResponse.json({ sent, devices: targets.length });
}
