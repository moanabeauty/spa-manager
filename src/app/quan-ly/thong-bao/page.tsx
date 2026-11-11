import { getCurrentUser } from "@/lib/supabase/server";
import PushToggle from "@/components/PushToggle";
import NotificationList, { type Noti } from "./NotificationList";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const { supabase, user } = await getCurrentUser();
  if (!user) return null;
  const { data } = await supabase
    .from("notifications")
    .select("id, kind, title, body, url, created_at, read_at")
    .order("created_at", { ascending: false })
    .limit(80);
  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-navy">Thông báo</h1>
      {vapidKey && <PushToggle publicKey={vapidKey} />}
      <NotificationList items={(data ?? []) as Noti[]} />
    </div>
  );
}
