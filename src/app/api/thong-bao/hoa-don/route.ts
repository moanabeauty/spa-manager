import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendPush } from "@/lib/webpush";

export const runtime = "nodejs";

// Vừa thu tiền hoá đơn có gói combo / nạp thẻ -> báo lên điện thoại của khách + chủ spa + quản lý.
// Cơ sở dữ liệu chỉ trả thiết bị nếu đúng người vừa thu, hoá đơn vừa chốt và chưa báo lần nào.
export async function POST(request: Request) {
  const { invoiceId } = (await request.json().catch(() => ({}))) as { invoiceId?: string };
  if (!invoiceId) return NextResponse.json({ error: "Thiếu mã hoá đơn" }, { status: 400 });
  if (!process.env.VAPID_PRIVATE_KEY) return NextResponse.json({ sent: 0, reason: "Chưa cài khoá thông báo" });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("invoice_push_targets", { p_invoice: invoiceId });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const targets = (data ?? []) as { sub_endpoint: string; sub_p256dh: string; sub_auth: string; title: string; body: string; url: string }[];
  let sent = 0;
  await Promise.all(
    targets.map(async (t) => {
      try {
        const status = await sendPush(
          { endpoint: t.sub_endpoint, p256dh: t.sub_p256dh, auth: t.sub_auth },
          { title: t.title, body: t.body, url: t.url, tag: `hoa-don-${invoiceId}` },
        );
        if (status >= 200 && status < 300) sent++;
        else if (status === 404 || status === 410) await supabase.rpc("drop_push_subscription", { p_endpoint: t.sub_endpoint });
      } catch {
        // bỏ qua thiết bị lỗi
      }
    }),
  );
  return NextResponse.json({ sent, devices: targets.length });
}
