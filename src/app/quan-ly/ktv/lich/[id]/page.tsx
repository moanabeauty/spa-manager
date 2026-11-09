import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import { formatShortDate, formatTime, formatVnd } from "@/lib/format";
import { CARD_ALERT, COMBO_ALERT } from "@/lib/ktv";
import type { PickService } from "../../ServicePicker";
import DetailActions from "./DetailActions";
import SessionPhotos from "@/components/SessionPhotos";
import PhotoHistory from "@/components/PhotoHistory";
import { loadCustomerPhotos, photosRequired } from "@/lib/photos";

export const metadata = { title: "Chi tiết lịch – Moana Beauty" };

type Aps = {
  id: string;
  technician_id: string | null;
  start_at: string;
  end_at: string;
  is_active: boolean;
  work_started_at: string | null;
  work_done_at: string | null;
  service_id: string;
  services: { name: string; name_en: string | null } | null;
};
type Appt = {
  id: string;
  start_at: string;
  end_at: string | null;
  status: string;
  branch_id: string;
  customer_id: string;
  note: string | null;
  ktv_confirmed_at: string | null;
  ktv_confirmed_auto: boolean;
  is_consultation: boolean;
  photo_skip_reason: string | null;
  customers: { full_name: string; code: string | null } | null;
  appointment_services: Aps[];
};
type View = {
  card_balance: number;
  packages: { item_id: string; package: string; label: string; left: number | null; expires_at: string | null }[];
  debt: number;
  debt_since: string | null;
  visits: number;
  history: { start_at: string; services: string; techs: string | null }[];
  skin: { record_date: string; overall: "green" | "yellow" | "red"; customer_needs: string | null; reaction: string | null; recommendation: string | null } | null;
};

const SKIN = [
  { key: "green", label: "Xanh", hint: "Da ổn định", box: "bg-[#E4E4EF] text-navy", ring: "outline-navy" },
  { key: "yellow", label: "Vàng", hint: "Cần theo dõi", box: "bg-beige text-[#5E4B30]", ring: "outline-brown" },
  { key: "red", label: "Đỏ", hint: "Có vấn đề", box: "bg-[#FDECEA] text-[#8C1D18]", ring: "outline-[#B3261E]" },
] as const;

/** Chi tiết lịch / thông tin khách cho KTV: không hiện SĐT */
export default async function KtvAppointmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, profile } = await getCurrentUser();
  if (!profile) return null;

  const [{ data: appt }, { data: view, error }, { data: svcs }] = await Promise.all([
    supabase
      .from("appointments")
      .select(
        "id, start_at, end_at, status, branch_id, customer_id, note, ktv_confirmed_at, ktv_confirmed_auto, is_consultation, photo_skip_reason, customers(full_name, code), appointment_services(id, technician_id, service_id, start_at, end_at, is_active, work_started_at, work_done_at, services(name, name_en))",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.rpc("ktv_customer_view", { p_appt: id }),
    supabase.from("services").select("id, name, name_en, duration_minutes, branch_id, service_categories(name)").eq("is_active", true).order("name_en"),
  ]);
  if (!appt || error) {
    return (
      <div className="card text-sm">
        {error ? "Bạn chỉ xem được khách của lịch mình phục vụ." : "Không tìm thấy lịch hẹn."}{" "}
        <Link href="/quan-ly" className="font-semibold text-navy underline">Về Hôm nay</Link>
      </div>
    );
  }
  const a = appt as unknown as Appt;
  const v = view as View;
  const mine = a.appointment_services
    .filter((s) => s.is_active && (profile.role !== "technician" || s.technician_id === profile.id))
    .sort((x, y) => x.start_at.localeCompare(y.start_at));
  const consult = a.is_consultation || a.appointment_services.length === 0;
  const end = a.end_at ?? mine[mine.length - 1]?.end_at ?? null;
  const svcNames = consult ? "Hẹn tư vấn" : mine.map((s) => s.services?.name_en || s.services?.name).join(" + ");
  const card = Number(v.card_balance);
  const debt = Number(v.debt);
  const lowCombo = v.packages.filter((p) => p.left !== null && p.left < COMBO_ALERT);
  const closed = ["completed", "cancelled", "no_show"].includes(a.status);
  const current = mine.find((s) => !s.work_done_at) ?? mine[0];
  const activeSvcIds = a.appointment_services.filter((s) => s.is_active).map((s) => s.service_id);
  const [photoSessions, needPhotos] = await Promise.all([loadCustomerPhotos(supabase, a.customer_id), photosRequired(supabase, activeSvcIds)]);
  const thisSession = photoSessions.find((s) => s.appointmentId === a.id)?.photos ?? [];
  const pastSessions = photoSessions.filter((s) => s.appointmentId !== a.id);
  const canEditPhotos = profile.role === "owner" || profile.role === "manager" || (profile.role === "technician" && mine.length > 0 && !closed);
  const services: PickService[] = ((svcs ?? []) as unknown as (Omit<PickService, "category"> & { service_categories: { name: string } | null })[]).map((s) => ({
    ...s,
    category: s.service_categories?.name ?? null,
  }));

  return (
    <div className="-mx-4 -mt-6 pb-40">
      <div className="space-y-1.5 bg-navy px-5 pb-5 pt-4 text-white">
        <Link href="/quan-ly" className="flex min-h-8 items-center text-sm text-beige-dark">‹ Hôm nay</Link>
        <h1 className="text-[22px] font-bold">{a.customers?.full_name ?? "Khách"}</h1>
        <p className="text-sm text-[#C9CADB]">
          {formatTime(a.start_at)}
          {end ? ` – ${formatTime(end)}` : ""} · {svcNames}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {card > 0 && <span className="rounded-full bg-brown px-2.5 py-1 text-xs font-semibold text-black">Khách thẻ</span>}
          {v.packages.length > 0 && <span className="rounded-full bg-brown px-2.5 py-1 text-xs font-semibold text-black">Khách combo</span>}
          <span className="rounded-full bg-white/15 px-2.5 py-1 text-xs">{Number(v.visits) === 0 ? "Khách mới" : `Lần thứ ${Number(v.visits) + 1}`}</span>
          {a.customers?.code && <span className="rounded-full bg-white/15 px-2.5 py-1 text-xs">{a.customers.code}</span>}
        </div>
      </div>

      <div className="space-y-3 px-4 pt-4">
        {debt > 0 && (
          <div className="space-y-1 rounded-xl bg-[#B3261E] px-3.5 py-3 text-white">
            <p className="text-sm font-bold">Khách đang nợ spa: {formatVnd(debt)}</p>
            <p className="text-[13px]">
              {v.debt_since ? `Từ hoá đơn ngày ${formatShortDate(v.debt_since)}. ` : ""}Cảnh báo này hiện cho chủ, quản lý và KTV phục vụ khách.
            </p>
          </div>
        )}
        {((card > 0 && card < CARD_ALERT) || lowCombo.length > 0) && (
          <div className="space-y-1 rounded-xl bg-[#FDECEA] px-3.5 py-3 text-[#8C1D18]">
            <p className="text-sm font-bold">Gợi ý tư vấn</p>
            {card > 0 && card < CARD_ALERT && (
              <p className="text-[13px]">Thẻ trả trước còn {formatVnd(card)} (dưới 2 triệu). Có thể tư vấn nạp thêm thẻ 5tr / 10tr / 20tr.</p>
            )}
            {lowCombo.map((p) => (
              <p key={p.item_id} className="text-[13px]">
                Combo {p.package} · {p.label}: còn {p.left} buổi. Có thể tư vấn gia hạn / mua combo mới.
              </p>
            ))}
          </div>
        )}
        {a.note && <div className="rounded-xl bg-white px-3.5 py-3 text-[13px]"><b>Ghi chú lịch:</b> {a.note}</div>}

        <div className="grid grid-cols-2 gap-2.5">
          <div className="rounded-[14px] bg-white p-3">
            <p className="text-xs text-[#646464]">Số dư thẻ</p>
            <p className={`text-[17px] font-bold ${card > 0 && card < CARD_ALERT ? "text-[#8C1D18]" : ""}`}>{formatVnd(card)}</p>
          </div>
          <div className="rounded-[14px] bg-white p-3">
            <p className="text-xs text-[#646464]">Combo đang có</p>
            {v.packages.length === 0 ? (
              <p className="text-[17px] font-bold">Không có</p>
            ) : (
              <ul className="text-[13px]">
                {v.packages.map((p) => (
                  <li key={p.item_id} className={p.left !== null && p.left < COMBO_ALERT ? "text-[#8C1D18]" : ""}>
                    {p.label}: <b>{p.left === null ? "không giới hạn" : `còn ${p.left} buổi`}</b>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="space-y-2.5 rounded-[14px] bg-white p-3.5">
          <p className="text-[15px] font-bold">Thẻ theo dõi da</p>
          <div className="flex gap-2">
            {SKIN.map((c) => (
              <div key={c.key} className={`flex-1 rounded-[10px] p-2 text-xs ${c.box} ${v.skin?.overall === c.key ? `outline-2 ${c.ring} outline` : ""}`}>
                <b>{c.label}</b>
                <br />
                {c.hint}
              </div>
            ))}
          </div>
          {v.skin ? (
            <p className="text-[13px] text-[#646464]">
              Buổi trước ({formatShortDate(v.skin.record_date)}): {[v.skin.reaction, v.skin.customer_needs].filter(Boolean).join(" · ") || "chưa ghi chú"}
            </p>
          ) : (
            <p className="text-[13px] text-[#646464]">Chưa có phiếu theo dõi da.</p>
          )}
          <Link href={`/quan-ly/phieu-da?kh=${a.customer_id}&lich=${a.id}&back=/quan-ly/ktv/lich/${a.id}`} className="block text-[13px] font-semibold text-navy">
            Ghi phiếu da buổi này ›
          </Link>
        </div>

        {!consult && (
          <SessionPhotos
            appointmentId={a.id}
            photos={thisSession}
            editable={canEditPhotos && !["cancelled", "no_show"].includes(a.status)}
            required={needPhotos}
            skipReason={a.photo_skip_reason}
          />
        )}
        <PhotoHistory sessions={pastSessions} title="Ảnh các buổi trước" empty="Chưa có ảnh các buổi trước." />

        <div className="space-y-1.5 rounded-[14px] bg-white p-3.5">
          <p className="text-[15px] font-bold">Lịch sử gần đây</p>
          {v.history.length === 0 && <p className="text-[13px] text-[#646464]">Chưa có buổi nào hoàn thành.</p>}
          {v.history.map((h) => (
            <div key={h.start_at} className="flex justify-between gap-2 text-[13px]">
              <span>
                {formatShortDate(h.start_at)} · {h.services}
              </span>
              <span className="shrink-0 text-[#646464]">{h.techs ? `KTV ${h.techs}` : ""}</span>
            </div>
          ))}
        </div>

        {mine.length > 1 && (
          <div className="space-y-1.5 rounded-[14px] bg-white p-3.5">
            <p className="text-[15px] font-bold">Liệu trình của bạn trong lịch này</p>
            {mine.map((s) => (
              <Link key={s.id} href={`/quan-ly/ktv/lieu-trinh/${s.id}`} className="flex justify-between text-[13px] text-navy">
                <span>{formatTime(s.start_at)} · {s.services?.name_en || s.services?.name}</span>
                <span>{s.work_done_at ? "Xong" : s.work_started_at ? "Đang làm" : "Quy trình ›"}</span>
              </Link>
            ))}
          </div>
        )}

        <p className="flex items-center gap-1.5 text-xs text-[#646464]">
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          Số điện thoại khách được ẩn với KTV
        </p>
      </div>

      <DetailActions
        appointmentId={a.id}
        confirmed={!!a.ktv_confirmed_at}
        autoTime={formatTime(a.start_at)}
        procedureHref={current ? `/quan-ly/ktv/lieu-trinh/${current.id}` : null}
        consult={consult}
        customerId={a.customer_id}
        branchId={a.branch_id}
        services={services}
        closed={closed}
      />
    </div>
  );
}
