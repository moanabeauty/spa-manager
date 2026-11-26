"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatVnd, vnError } from "@/lib/format";

export type PayCombo = { item_id: string; package: string; label: string; left: number | null };
export type PayRow = {
  id: string;
  service_id: string;
  label: string;
  price: number | null;
  member_price: number | null;
  card_ok: boolean;
  pay_with: "combo" | "card" | "cash" | null;
  item_id: string | null;
  done: boolean;
  editable: boolean;
  combos: PayCombo[];
};
export type PayOptions = {
  card: { code: string; balance: number } | null;
  invoiced: boolean;
  rows: PayRow[];
};

/** KTV chọn khách thanh toán từng liệu trình bằng: combo nào / thẻ trả trước / trả tiền lẻ */
export default function PaymentChoice({ options }: { options: PayOptions }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { card, rows, invoiced } = options;
  if (rows.length === 0) return null;

  // số dư thẻ còn lại sau các liệu trình đã chọn trừ thẻ trong lịch này
  const cardUsed = rows.reduce((t, r) => t + (r.pay_with === "card" ? Number(r.member_price ?? 0) : 0), 0);
  const cardLeft = card ? Number(card.balance) - cardUsed : 0;

  async function choose(r: PayRow, pay: "combo" | "card" | "cash", item: string | null = null) {
    if (r.pay_with === pay && (pay !== "combo" || r.item_id === item)) return;
    setBusy(`${r.id}-${pay}-${item ?? ""}`);
    setError(null);
    const { error: e } = await createClient().rpc("ktv_set_payment", { p_aps: r.id, p_pay: pay, p_item: item });
    setBusy(null);
    if (e) return setError(vnError(e.message));
    router.refresh();
  }

  const btn = (on: boolean) =>
    `flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-[13px] disabled:opacity-50 ${
      on ? "bg-navy text-white" : "bg-cream text-black"
    }`;

  return (
    <div className="space-y-3 rounded-[14px] bg-white p-3.5">
      <div>
        <p className="text-[15px] font-bold">Khách thanh toán bằng</p>
        <p className="text-xs text-[#646464]">
          Chọn cho từng liệu trình: trừ combo nào, trừ thẻ trả trước hay trả tiền lẻ. Lễ tân thấy sẵn lựa chọn này khi thu tiền.
        </p>
      </div>
      {invoiced && <p className="rounded-lg bg-[#E4F2E9] px-3 py-2 text-xs font-semibold text-[#1F5E3A]">Lịch này đã thu tiền – muốn đổi báo lễ tân / quản lý sửa hoá đơn.</p>}

      {rows.map((r) => {
        const lock = invoiced || !r.editable;
        const memberCost = Number(r.member_price ?? 0);
        const short = r.pay_with !== "card" && card && memberCost > cardLeft;
        return (
          <div key={r.id} className="space-y-1.5 border-t border-[#EEE5D6] pt-2.5 first:border-0 first:pt-0">
            <p className="text-sm font-semibold">
              {r.label}
              {r.pay_with === null && !lock && <span className="ml-1.5 rounded-full bg-[#FDECEA] px-1.5 py-0.5 text-[10px] font-semibold text-[#8C1D18]">chưa chọn</span>}
            </p>
            {!r.editable && !invoiced && <p className="text-[11px] text-[#646464]">Liệu trình của KTV khác – KTV đó chọn.</p>}

            {r.combos.map((c) => {
              const on = r.pay_with === "combo" && r.item_id === c.item_id;
              return (
                <button key={c.item_id} type="button" className={btn(on)} disabled={lock || !!busy} onClick={() => choose(r, "combo", c.item_id)}>
                  <span className="min-w-0">
                    <span className="block font-semibold">{on ? "✓ " : ""}Trừ combo {c.package}</span>
                    <span className={`block text-xs ${on ? "text-white/80" : "text-[#646464]"}`}>{c.label}</span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${on ? "bg-white/20" : "bg-beige text-[#5E4B30]"}`}>
                    {c.left === null ? "không giới hạn" : `còn ${c.left} buổi`}
                  </span>
                </button>
              );
            })}

            {card && r.card_ok && (
              <button type="button" className={btn(r.pay_with === "card")} disabled={lock || !!busy} onClick={() => choose(r, "card")}>
                <span className="min-w-0">
                  <span className="block font-semibold">{r.pay_with === "card" ? "✓ " : ""}Trừ thẻ trả trước {card.code}</span>
                  <span className={`block text-xs ${r.pay_with === "card" ? "text-white/80" : short ? "text-[#B3261E]" : "text-[#646464]"}`}>
                    Giá member {formatVnd(memberCost)} · thẻ còn {formatVnd(Number(card.balance))}
                    {short ? " – không đủ, sẽ tính giá niêm yết" : ""}
                  </span>
                </span>
              </button>
            )}

            <button type="button" className={btn(r.pay_with === "cash")} disabled={lock || !!busy} onClick={() => choose(r, "cash")}>
              <span className="min-w-0">
                <span className="block font-semibold">{r.pay_with === "cash" ? "✓ " : ""}Trả tiền lẻ</span>
                <span className={`block text-xs ${r.pay_with === "cash" ? "text-white/80" : "text-[#646464]"}`}>
                  {r.price === null ? "Giá theo lễ tân nhập" : `Giá niêm yết ${formatVnd(Number(r.price))}`} · tiền mặt / CK / POS
                </span>
              </span>
            </button>
          </div>
        );
      })}
      {error && <p className="text-xs text-[#B3261E]">{error}</p>}
    </div>
  );
}
