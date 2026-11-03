import Link from "next/link";
import { getCurrentUser, isStaffRole } from "@/lib/supabase/server";

export default async function Header() {
  const { user, profile } = await getCurrentUser();
  const staff = isStaffRole(profile?.role);

  return (
    <header className="sticky top-0 z-20 bg-navy text-white shadow">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="flex flex-col leading-tight">
          <span className="text-lg font-bold tracking-[0.2em]">MOANA</span>
          <span className="text-[10px] uppercase tracking-[0.3em] text-beige">Beauty · Spa</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          {user ? (
            <>
              {staff && (
                <Link href="/quan-ly" className="rounded-full px-3 py-1.5 hover:bg-white/10">
                  Quản lý
                </Link>
              )}
              <Link href="/dat-lich" className="rounded-full px-3 py-1.5 hover:bg-white/10">
                Đặt lịch
              </Link>
              <Link href="/lich-hen" className="rounded-full px-3 py-1.5 hover:bg-white/10">
                Lịch của tôi
              </Link>
              <form action="/dang-xuat" method="post">
                <button className="rounded-full px-3 py-1.5 text-beige hover:bg-white/10" title={profile?.full_name ?? ""}>
                  Thoát
                </button>
              </form>
            </>
          ) : (
            <Link href="/dang-nhap" className="rounded-full bg-beige px-4 py-1.5 font-semibold text-navy">
              Đăng nhập
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
