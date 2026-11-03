import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import type { CrmSettings, Group } from "@/lib/crm";
import GroupsEditor, { CrmSettingsForm } from "./GroupsEditor";

export const metadata = { title: "Nhóm khách – Moana Beauty" };

export default async function GroupsPage() {
  const { supabase, profile } = await getCurrentUser();
  if (profile?.role !== "owner" && profile?.role !== "manager") {
    return <p className="card text-sm">Chỉ chủ spa và quản lý quản lý được nhóm khách.</p>;
  }
  const [{ data: groups }, { data: members }, { data: settings }] = await Promise.all([
    supabase.from("customer_groups").select("id, name, color, description, sort_order").order("sort_order").order("name"),
    supabase.from("customer_group_members").select("group_id"),
    supabase.rpc("crm_settings"),
  ]);
  const counts: Record<string, number> = {};
  for (const m of (members ?? []) as { group_id: string }[]) counts[m.group_id] = (counts[m.group_id] ?? 0) + 1;

  return (
    <div className="space-y-4">
      <Link href="/quan-ly/khach-hang" className="text-sm font-semibold text-navy">← Khách hàng</Link>
      <div>
        <h1 className="text-2xl font-bold text-navy">Nhóm khách</h1>
        <p className="mt-1 text-sm text-ink/70">
          Nhóm tự tạo (vd Da mụn, Khách giới thiệu) – lễ tân / KTV gắn khách vào nhóm ở hồ sơ khách. Ngoài ra hệ thống tự chia nhóm: khách mới,
          quay lại, đã mua gói / thẻ, VIP, còn buổi / số dư, lâu chưa quay lại, sinh nhật tháng này.
        </p>
      </div>
      <GroupsEditor groups={(groups ?? []) as Group[]} counts={counts} />
      {profile.role === "owner" && settings && <CrmSettingsForm settings={settings as CrmSettings} />}
    </div>
  );
}
