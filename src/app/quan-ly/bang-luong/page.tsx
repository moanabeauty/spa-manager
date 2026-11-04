import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import PayrollScreen from "./screen";

export const metadata = { title: "Bảng lương – Moana Beauty" };

export default async function PayrollPage({ searchParams }: { searchParams: Promise<{ thang?: string }> }) {
  const sp = await searchParams;
  const { profile } = await getCurrentUser();
  // quản lý không xem lương: chuyển sang chấm công
  if (profile?.role === "manager") redirect(`/quan-ly/cham-cong${sp.thang ? `?thang=${sp.thang}` : ""}`);
  return <PayrollScreen mode="luong" thang={sp.thang} />;
}
