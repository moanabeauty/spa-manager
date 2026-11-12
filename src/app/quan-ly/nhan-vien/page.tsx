import { activeBranches } from "@/lib/refData";
import { getCurrentUser } from "@/lib/supabase/server";
import AccountList, { type Account } from "./AccountList";

export const metadata = { title: "Nhân viên – Moana Beauty" };

export default async function StaffAccountsPage() {
  const { supabase, user, profile } = await getCurrentUser();
  if (profile?.role !== "owner") {
    return <p className="card text-sm">Chỉ chủ spa xem được trang này.</p>;
  }
  const [{ data: accounts, error }, { data: branches }] = await Promise.all([
    supabase.rpc("list_accounts_v2"),
    activeBranches(),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-navy">Nhân viên và tài khoản</h1>
        <p className="mt-1 text-sm text-ink/70">
          Nhân viên tự đăng ký tài khoản ở trang Đăng nhập (mặc định là khách hàng). Sau đó bạn tìm tên / email / SĐT của
          họ ở đây và cấp vai trò, chi nhánh.
        </p>
      </div>
      {error && <p className="card text-sm text-[#8A2323]">Không tải được danh sách: {error.message}</p>}
      <AccountList accounts={(accounts ?? []) as Account[]} branches={branches ?? []} myId={user!.id} />
    </div>
  );
}
