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
    <div className="mx-auto max-w-md">
      <AuthForm
        next={next}
        initialTab={sp.tab === "dang-ky" ? "signup" : "login"}
        linkError={sp.loi === "link"}
      />
    </div>
  );
}
