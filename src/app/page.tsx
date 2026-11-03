import Link from "next/link";
import { getCurrentUser, isStaffRole } from "@/lib/supabase/server";

export default async function Home() {
  const { supabase, user, profile } = await getCurrentUser();
  const { data: branches } = await supabase.from("branches").select("id, name, address").eq("is_active", true).order("name");

  return (
    <div className="space-y-6">
      <section className="rounded-3xl bg-beige px-6 py-10 text-center">
        <p className="text-xs uppercase tracking-[0.35em] text-brown">Moana Beauty</p>
        <h1 className="mt-3 text-2xl font-bold text-navy sm:text-3xl">Đặt lịch chăm sóc da</h1>
        <p className="mx-auto mt-3 max-w-md text-sm text-ink/80">
          Chọn chi nhánh, dịch vụ và giờ phù hợp. Moana sẽ xác nhận lịch với bạn sớm nhất.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/dat-lich" className="btn-primary">
            Đặt lịch ngay
          </Link>
          <Link href="/menu" className="btn-outline">
            Menu dịch vụ
          </Link>
          <Link href="/khuyen-mai" className="btn-outline">
            Xem khuyến mãi
          </Link>
          {user ? (
            <Link href="/lich-hen" className="btn-outline">
              Xem lịch của tôi
            </Link>
          ) : (
            <Link href="/dang-nhap?tab=dang-ky" className="btn-outline">
              Tạo tài khoản
            </Link>
          )}
        </div>
        {user && profile && (
          <p className="mt-5 text-sm text-ink/70">
            Xin chào, <b>{profile.full_name}</b>
            {isStaffRole(profile.role) && (
              <>
                {" · "}
                <Link href="/quan-ly" className="font-semibold text-navy underline">
                  Mở lịch hẹn của spa
                </Link>
              </>
            )}
          </p>
        )}
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        {(branches ?? []).map((b) => (
          <div key={b.id} className="card">
            <p className="font-semibold text-navy">{b.name}</p>
            <p className="mt-1 text-sm text-ink/70">{b.address}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
