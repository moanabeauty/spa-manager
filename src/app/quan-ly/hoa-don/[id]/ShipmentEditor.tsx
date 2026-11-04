"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { vnError } from "@/lib/format";
import { SHIP_STATUS } from "@/lib/shipping";
import MoneyInput from "@/components/MoneyInput";

export type Shipment = {
  carrier: string | null;
  tracking_code: string | null;
  recipient_name: string | null;
  recipient_phone: string | null;
  address: string | null;
  shipping_fee: number;
  cod_amount: number;
  status: string;
  note: string | null;
};

/** Cập nhật mã vận đơn, trạng thái giao hàng của đơn online */
export default function ShipmentEditor({ invoiceId, initial }: { invoiceId: string; initial: Shipment }) {
  const router = useRouter();
  const [open, setOpen] = useState(!initial.tracking_code);
  const [s, setS] = useState({
    carrier: initial.carrier ?? "",
    tracking_code: initial.tracking_code ?? "",
    recipient_name: initial.recipient_name ?? "",
    recipient_phone: initial.recipient_phone ?? "",
    address: initial.address ?? "",
    shipping_fee: Number(initial.shipping_fee),
    status: initial.status,
    note: initial.note ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save(status?: string) {
    setBusy(true);
    setMsg(null);
    const { error } = await createClient().rpc("update_shipment", { p_invoice: invoiceId, p: { ...s, status: status ?? s.status } });
    setBusy(false);
    if (error) return setMsg(vnError(error.message));
    if (status) setS({ ...s, status });
    setMsg("Đã lưu.");
    router.refresh();
  }

  return (
    <div className="card space-y-2 p-4 text-sm print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-navy">Đơn giao hàng</p>
        <div className="flex flex-wrap gap-1">
          {Object.entries(SHIP_STATUS).map(([k, v]) => (
            <button
              key={k}
              disabled={busy}
              onClick={() => save(k)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${s.status === k ? v.cls + " ring-1 ring-current" : "bg-white text-ink/60 ring-1 ring-beige-dark"}`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>
      {!open ? (
        <button className="text-xs text-navy underline" onClick={() => setOpen(true)}>Sửa mã vận đơn / thông tin giao hàng</button>
      ) : (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <input className="input py-2 text-sm" placeholder="Đơn vị vận chuyển" value={s.carrier} onChange={(e) => setS({ ...s, carrier: e.target.value })} />
            <input className="input py-2 text-sm" placeholder="Mã vận đơn" value={s.tracking_code} onChange={(e) => setS({ ...s, tracking_code: e.target.value })} />
            <input className="input py-2 text-sm" placeholder="Người nhận" value={s.recipient_name} onChange={(e) => setS({ ...s, recipient_name: e.target.value })} />
            <input className="input py-2 text-sm" placeholder="SĐT người nhận" value={s.recipient_phone} onChange={(e) => setS({ ...s, recipient_phone: e.target.value })} />
          </div>
          <input className="input py-2 text-sm" placeholder="Địa chỉ" value={s.address} onChange={(e) => setS({ ...s, address: e.target.value })} />
          <div className="flex items-center gap-2">
            <span className="w-20 shrink-0 text-xs">Phí ship</span>
            <MoneyInput value={s.shipping_fee} onChange={(v) => setS({ ...s, shipping_fee: v })} className="flex-1" ariaLabel="Phí ship" />
          </div>
          <input className="input py-2 text-sm" placeholder="Ghi chú giao hàng" value={s.note} onChange={(e) => setS({ ...s, note: e.target.value })} />
          <div className="flex justify-end">
            <button className="btn-primary py-2" disabled={busy} onClick={() => save()}>Lưu thông tin giao hàng</button>
          </div>
        </div>
      )}
      {msg && <p className="text-xs">{msg}</p>}
    </div>
  );
}
