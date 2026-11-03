"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { vnError } from "@/lib/format";

/** Khách đang xem menu cấp nào; chủ / quản lý mở toàn bộ menu thủ công cho khách chưa mua gói */
export default function MenuUnlockToggle({
  customerId,
  fullMenu,
  manual,
  auto,
  canEdit,
}: {
  customerId: string;
  fullMenu: boolean;
  manual: boolean;
  auto: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function set(on: boolean) {
    setBusy(true);
    setError(null);
    const { error } = await createClient().rpc("set_customer_menu_unlock", { p_customer: customerId, p_on: on });
    setBusy(false);
    if (error) return setError(vnError(error.message));
    router.refresh();
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-cream px-3 py-2 text-sm">
      <span>
        Menu khách xem online:{" "}
        <b className={fullMenu ? "text-[#22612A]" : "text-navy"}>{fullMenu ? "Toàn bộ dịch vụ" : "Menu khách mới"}</b>
        <span className="text-xs text-ink/60">
          {auto ? " (đã mua gói / thẻ)" : manual ? " (chủ / quản lý mở thủ công)" : " (chưa mua gói)"}
        </span>
      </span>
      {canEdit && !auto && (
        <button className="btn-ghost ml-auto py-1" disabled={busy} onClick={() => set(!manual)}>
          {manual ? "Khoá lại menu khách mới" : "Mở toàn bộ menu"}
        </button>
      )}
      {error && <p className="w-full text-xs text-[#8A2323]">{error}</p>}
    </div>
  );
}
