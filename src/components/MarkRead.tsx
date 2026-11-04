"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

/** Đánh dấu đã xem sau vài giây trên màn hình (lần sau mở trang không còn chữ "mới") */
export default function MarkRead({ ids }: { ids: string[] }) {
  const key = ids.join(",");
  useEffect(() => {
    const t = setTimeout(() => {
      createClient().rpc("mark_notifications_read", { p_ids: key.split(",") }).then(() => {});
    }, 3000);
    return () => clearTimeout(t);
  }, [key]);
  return null;
}
