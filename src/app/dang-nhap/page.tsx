import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import AuthForm from "./AuthForm";

export const metadata = { title: "Đăng nhập – Moana Beauty" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; tab?: string; loi?: string }>;
}) {
  const sp = await searchParams;
  const next = sp.next && sp.next.startsWith("/") && !sp.next.startsWith("//") ? sp.next : "/dat-lich";
  const { user } = await getCurrentUser();
  if (user) redirect(next);

  return (
    <div className="mx-auto max-w-md space-y-5">
      <div className="brand-sheen rounded-3xl px-6 py-8 text-center ring-1 ring-gold/30">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-moana.png" alt="Moana Beauty" width={212} height={74} className="mx-auto h-16 w-auto" />
        <p className="mt-3 text-xs uppercase tracking-[0.3em] text-brown">67 Lưu Quang Vũ · 109 Nguyễn Sơn</p>
      </div>
      <AuthForm
        next={next}
        initialTab={sp.tab === "dang-ky" ? "signup" : "login"}
        linkError={sp.loi === "link"}
      />
    </div>
  );
}
