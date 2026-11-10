import Link from "next/link";
import type { Profile } from "@/lib/supabase/server";
import { createClient } from "@/lib/supabase/server";
import { formatTime, formatVnd, todayVn } from "@/lib/format";
import { CARD_ALERT, COMBO_ALERT, ktvState, weekdayShort, type MyDayRow } from "@/lib/ktv";
import KtvServiceSearch from "./KtvServiceSearch";
import AttendanceCard, { type TodayAtt } from "./AttendanceCard";
import OpenBookings, { type OpenBooking } from "./OpenBookings";

/** Màn "Hôm nay" của KTV: chấm công, cảnh báo, khách của tôi hôm nay */
export default async function KtvHome({ profile }: { profile: Profile }) {
  const supabase = await createClient();
  await supabase.rpc("ktv_auto_accept"); // đến giờ hẹn mà chưa xác nhận -> hệ thống tự nhận
  const today = todayVn();
  const [{ data: rows }, { data: att }, { data: branch }, { data: cfg }, { data: openData }] = await Promise.all([
    supabase.rpc("ktv_my_day", { p_date: today }),
    supabase
      .from("staff_attendance")
      .select("check_in, check_out, in_distance_m, out_distance_m, approval_status, in_status, ot_status")
      .eq("staff_id", profile.id)
      .eq("work_date", today)
      .maybeSingle(),
    profile.branch_id ? supabase.from("branches").select("name").eq("id", profile.branch_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("app_settings").select("value").eq("key", "payroll").maybeSingle(),
    supabase.rpc("ktv_open_bookings", { p_days: 14 }),
  ]);
  const open = (openData ?? []) as OpenBooking[];
  const list = ((rows ?? []) as MyDayRow[]).map((r) => ({ ...r, card_balance: Number(r.card_balance), debt: Number(r.debt) }));
  // đang làm lên đầu, rồi chờ / đã nhận theo giờ, xong xuống cuối
  const rank = (r: MyDayRow) => (r.work_done || r.status === "completed" ? 2 : r.work_started || r.status === "in_progress" ? 0 : 1);
  list.sort((a, b) => rank(a) - rank(b) || a.start_at.localeCompare(b.start_at));

  const debtors = list.filter((r) => r.debt > 0).length;
  const advise = list.filter((r) => (r.card_balance > 0 && r.card_balance < CARD_ALERT) || (r.combo_min_left !== null && r.combo_min_left < COMBO_ALERT)).length;
  const pending = list.filter((r) => !r.ktv_confirmed_at && r.status !== "completed").length;
  const radius = Number((cfg?.value as { geo_radius_m?: number } | null)?.geo_radius_m ?? 100);
  const first = (profile.full_name ?? "").trim().split(/\s+/).pop() ?? "";

  return (
    <div className="-mx-4 -mt-6 space-y-4">
      <div className="bg-navy px-5 pb-6 pt-5 text-white">
        <div className="flex items-center gap-2 text-[13px] tracking-wider text-beige-dark">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-moana-light.png" alt="Moana" width={72} height={25} className="h-6 w-auto" />
          <span>· {(branch?.name ?? "").replace(/^Moana\s*/i, "").toUpperCase()}</span>
        </div>
        <h1 className="text-[22px] font-bold">Chào {first || "bạn"}</h1>
        <p className="text-sm text-[#C9CADB]">{weekdayShort(today)}/{today.slice(0, 4)}</p>
        <div className="mt-3">
          <KtvServiceSearch />
        </div>
      </div>

      <div className="space-y-3.5 px-4">
        <AttendanceCard today={att as TodayAtt} radius={radius} />

        {(debtors > 0 || advise > 0 || pending > 0 || open.length > 0) && (
          <div className="flex gap-2 rounded-xl bg-[#FDECEA] px-3.5 py-3 text-[13px] text-[#8C1D18]">
            <span className="font-bold">!</span>
            <span>
              {[
                pending ? `${pending} lịch chờ bạn xác nhận.` : "",
                open.length ? `${open.length} lịch chưa có KTV nhận.` : "",
                debtors ? `${debtors} khách đang nợ spa.` : "",
                advise ? `${advise} khách cần tư vấn: thẻ còn dưới 2 triệu hoặc combo còn dưới 3 buổi.` : "",
              ]
                .filter(Boolean)
                .join(" ")}
            </span>
          </div>
        )}

        <OpenBookings rows={open} />

        <div className="flex items-baseline justify-between">
          <h2 className="text-[17px] font-bold">Khách của tôi hôm nay</h2>
          <span className="text-[13px] text-[#646464]">{list.length} lịch</span>
        </div>

        {list.length === 0 && (
          <div className="rounded-2xl bg-white p-5 text-center text-sm text-[#646464]">
            Hôm nay bạn chưa có lịch khách.
            <Link href="/quan-ly/ktv/dat-lich" className="mt-3 block font-semibold text-navy underline">Đặt lịch cho khách</Link>
          </div>
        )}

        <ul className="space-y-2.5">
          {list.map((r) => {
            const st = ktvState(r);
            const done = st.label === "Xong";
            const working = st.label === "Đang làm";
            const lowCard = r.card_balance > 0 && r.card_balance < CARD_ALERT;
            const lowCombo = r.combo_min_left !== null && r.combo_min_left < COMBO_ALERT;
            const warn = [
              lowCombo ? `Combo còn ${r.combo_min_left} buổi` : "",
              lowCard ? `Thẻ còn ${formatVnd(r.card_balance)}` : "",
            ].filter(Boolean);
            return (
              <li key={r.appointment_id}>
                <Link
                  href={`/quan-ly/ktv/lich/${r.appointment_id}`}
                  className={`flex gap-3 rounded-[14px] bg-white p-3.5 ${working ? "border-2 border-navy" : ""} ${done ? "opacity-70" : ""}`}
                >
                  <span className={`w-[52px] shrink-0 text-[15px] font-bold ${done ? "text-[#646464]" : "text-navy"}`}>{formatTime(r.start_at)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold">{r.customer_name}</span>
                    <span className="block text-[13px] text-[#646464]">
                      {r.is_consultation ? "Chưa chọn liệu trình · hẹn tư vấn" : `${r.services}${r.minutes ? ` · ${r.minutes} phút` : ""}`}
                    </span>
                    {(warn.length > 0 || r.debt > 0) && (
                      <span className="block text-xs text-[#8C1D18]">
                        {warn.join(" · ")}
                        {r.debt > 0 && <>{warn.length ? " · " : ""}<b>Đang nợ spa</b></>}
                      </span>
                    )}
                  </span>
                  <span className={`self-center whitespace-nowrap rounded-full px-2.5 py-1.5 text-xs font-semibold ${st.style}`}>{st.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
