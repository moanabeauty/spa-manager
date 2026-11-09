import type { SupabaseClient } from "@supabase/supabase-js";
import { thumbPath } from "./photoCompress";

export const PHOTO_BUCKET = "session-photos";
export const ANGLES = [
  { key: "left", label: "Góc trái" },
  { key: "front", label: "Thẳng mặt" },
  { key: "right", label: "Góc phải" },
] as const;
export const ANGLE_LABEL: Record<string, string> = { left: "Góc trái", front: "Thẳng mặt", right: "Góc phải", extra: "Ảnh thêm" };

export type Photo = {
  id: string;
  appointmentId: string;
  phase: "before" | "after";
  angle: "left" | "front" | "right" | "extra";
  path: string;
  url: string;
  thumbUrl: string;
  createdAt: string;
};
export type PhotoSession = { appointmentId: string; startAt: string; services: string; photos: Photo[] };

type Row = {
  id: string;
  appointment_id: string;
  phase: Photo["phase"];
  angle: Photo["angle"];
  path: string;
  created_at: string;
  appointments: { start_at: string; appointment_services: { is_active: boolean; services: { name: string; name_en: string | null } | null }[] } | null;
};

/** Ảnh trước–sau của 1 khách, gom theo buổi (mới nhất trước), kèm link xem có hạn 2 giờ */
export async function loadCustomerPhotos(supabase: SupabaseClient, customerId: string, appointmentId?: string): Promise<PhotoSession[]> {
  let q = supabase
    .from("session_photos")
    .select("id, appointment_id, phase, angle, path, created_at, appointments(start_at, appointment_services(is_active, services(name, name_en)))")
    .eq("customer_id", customerId);
  if (appointmentId) q = q.eq("appointment_id", appointmentId);
  const { data } = await q.order("created_at", { ascending: false }).limit(300);
  const rows = (data ?? []) as unknown as Row[];
  if (!rows.length) return [];
  const paths = rows.flatMap((r) => [r.path, thumbPath(r.path)]);
  const { data: signed } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 7200);
  const urlOf = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));

  const sessions = new Map<string, PhotoSession>();
  for (const r of rows) {
    let s = sessions.get(r.appointment_id);
    if (!s) {
      s = {
        appointmentId: r.appointment_id,
        startAt: r.appointments?.start_at ?? r.created_at,
        services: (r.appointments?.appointment_services ?? [])
          .filter((x) => x.is_active)
          .map((x) => x.services?.name_en || x.services?.name)
          .filter(Boolean)
          .join(" + "),
        photos: [],
      };
      sessions.set(r.appointment_id, s);
    }
    const url = urlOf.get(r.path) ?? "";
    s.photos.push({
      id: r.id,
      appointmentId: r.appointment_id,
      phase: r.phase,
      angle: r.angle,
      path: r.path,
      url,
      thumbUrl: urlOf.get(thumbPath(r.path)) || url,
      createdAt: r.created_at,
    });
  }
  const order = { left: 0, front: 1, right: 2, extra: 3 };
  return [...sessions.values()]
    .map((s) => ({ ...s, photos: s.photos.sort((a, b) => order[a.angle] - order[b.angle] || a.createdAt.localeCompare(b.createdAt)) }))
    .sort((a, b) => b.startAt.localeCompare(a.startAt));
}

/** Lịch hẹn có liệu trình mặt (quy trình gốc có bước Tẩy trang) -> bắt buộc chụp ảnh */
export async function photosRequired(supabase: SupabaseClient, serviceIds: string[]): Promise<boolean> {
  if (!serviceIds.length) return false;
  const { data } = await supabase.from("service_procedure_steps").select("title").in("service_id", serviceIds).lte("step_no", 3);
  return (data ?? []).some((r) => /t[ẩâ]y trang/i.test((r as { title: string }).title));
}
