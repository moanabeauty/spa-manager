import Link from "next/link";
import { getCurrentUser, isStaffRole } from "@/lib/supabase/server";

const link = "shrink-0 whitespace-nowrap rounded-full px-2.5 py-1.5 hover:bg-white/10";

export default async function Header() {
  const { user, profile } = await getCurrentUser();
  const staff = isStaffRole(profile?.role);

  return (
    <header className="sticky top-0 z-20 print:hidden bg-navy text-white shadow">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
        <Link href={staff ? "/quan-ly" : "/"} className="flex flex-col leading-tight">
          <span className="text-lg font-bold tracking-[0.2em]">MOANA</span>
          <span className="text-[10px] uppercase tracking-[0.3em] text-beige">Beauty · Spa</span>
        </Link>
        <nav className="flex min-w-0 items-center gap-0.5 overflow-x-auto text-sm">
          {staff ? (
            <>
              <Link href="/quan-ly" className={link}>Quản lý</Link>
              <Link href="/" className={link}>Trang khách</Link>
            </>
          ) : (
            <>
              <Link href="/menu" className={link}>Menu</Link>
              <Link href="/khuyen-mai" className={link}>Khuyến mãi</Link>
              <Link href="/lieu-trinh-moi" className={link}>Liệu trình mới</Link>
              <Link href="/goc-cham-da" className={link}>Góc chăm da</Link>
            </>
          )}
          {user ? (
            <>
              {!staff && (
                <>
                  <Link href="/dat-lich" className={link}>Đặt lịch</Link>
                  <Link href="/tai-khoan" className={link}>Tài khoản</Link>
                </>
              )}
              <form action="/dang-xuat" method="post">
                <button className={`${link} text-beige`} title={profile?.full_name ?? ""}>
                  Thoát
                </button>
              </form>
            </>
          ) : (
            <Link href="/dang-nhap" className="ml-1 shrink-0 rounded-full bg-beige px-4 py-1.5 font-semibold text-navy">
              Đăng nhập
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
