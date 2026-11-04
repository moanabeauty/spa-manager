import { getCurrentUser } from "@/lib/supabase/server";
import type { CrmSettings } from "@/lib/crm";
import { CrmSettingsForm } from "../../khach-hang/nhom/GroupsEditor";

export const metadata = { title: "Cài đặt CRM – Moana Beauty" };

export default async function CrmSettingsPage() {
  const { supabase, profile } = await getCurrentUser();
  if (profile?.role !== "owner") return <p className="card text-sm">Trang dành cho chủ spa.</p>;
  const { data: settings } = await supabase.rpc("crm_settings");
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-navy">Cài đặt CRM</h1>
        <p className="text-sm text-ink/70">Cách hệ thống tự chia nhóm khách và tạo nhắc chăm sóc.</p>
      </div>
      {settings ? <CrmSettingsForm settings={settings as CrmSettings} /> : <p className="card text-sm">Chưa đọc được cài đặt.</p>}
    </div>
  );
}
