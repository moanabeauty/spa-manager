import { formatDate, formatTime, formatVnd } from "@/lib/format";
import { METHOD_LABEL } from "@/lib/billing";
import type { Shipment } from "./ShipmentEditor";

type Item = { id: string; description: string | null; quantity: number; unit_price: number; discount: number; amount: number };
type Pay = { id: string; method: string; amount: number };
type Branch = { id: string; name: string; address: string | null; phone: string | null };

/**
 * Hoá đơn đơn online (in khổ A5, gập đôi):
 * nửa trên cho shipper = người nhận + số tiền cần thu; nửa dưới = sản phẩm.
 */
export default function OnlineReceipt({
  code,
  at,
  items,
  payments,
  debtPayments,
  sh,
  owed,
  cancelled,
  staff,
  branches,
}: {
  code: string;
  at: string;
  items: Item[];
  payments: Pay[];
  debtPayments: Pay[];
  sh: Shipment;
  owed: number;
  cancelled: boolean;
  staff: string | null;
  branches: Branch[];
}) {
  const total = items.reduce((a, i) => a + Number(i.amount), 0);
  const fee = Number(sh.shipping_fee) || 0;
  const customerPaysShip = (sh.ship_fee_payer ?? "customer") === "customer";
  const shipToCollect = customerPaysShip ? fee : 0;
  const collect = owed + shipToCollect; // shipper thu của khách
  const returned = sh.status === "returned";

  return (
    <div className="online-receipt mx-auto w-full max-w-[148mm] overflow-hidden rounded-2xl bg-white text-[13px] text-[#2a2a2a] shadow-sm ring-1 ring-beige-dark print:max-w-none print:rounded-none print:shadow-none print:ring-0">
      <style>{`@media print { @page { size: A5 portrait; margin: 0; } body { background: #fff !important; } .staff-content { padding: 0 !important; max-width: none !important; } .online-receipt { width: 148mm; } .or-half { height: 105mm; box-sizing: border-box; } }`}</style>

      {/* ---- NỬA TRÊN: cho shipper ---- */}
      <div className="or-half flex flex-col px-[9mm] pb-[4mm] pt-[6mm]">
        <div className="flex items-center justify-between gap-3 border-b-2 border-[#A0845E] pb-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-moana.png" alt="Moana Beauty" className="h-9 w-auto" />
          <div className="text-right text-[10.5px] leading-snug text-ink/80">
            <p className="font-bold text-navy">Hotline</p>
            {branches.map((b, i) => (
              <p key={b.id}>
                CS{i + 1} – {(b.address ?? b.name).replace(/, Hà Nội$/, "")}: <b className="text-navy">{b.phone ?? "…"}</b>
              </p>
            ))}
          </div>
        </div>
        <div className="my-1.5 flex justify-between text-[11px] text-ink/60">
          <span>
            Đơn online <b className="text-navy">{code}</b>
          </span>
          <span>
            {formatTime(at)} · {formatDate(at)}
          </span>
        </div>

        <div className="rounded-xl border-2 border-navy px-4 py-3">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.15em] text-[#A0845E]">Người nhận</p>
          <p className="text-[22px] font-bold leading-tight text-black">{sh.recipient_name ?? "—"}</p>
          <p className="text-[22px] font-bold tracking-wide text-black">{sh.recipient_phone ?? ""}</p>
          <p className="mt-1 text-[17px] leading-snug">{sh.address}</p>
          <p className="mt-2 border-t border-cream pt-1.5 text-[12.5px] text-ink/70">
            Đơn vị ship: <b>{sh.carrier ?? "—"}</b> · Mã vận đơn: <b>{sh.tracking_code ?? "(chưa có)"}</b>
          </p>
        </div>

        {cancelled ? (
          <div className="mt-2 rounded-xl border-2 border-[#8A2323] p-3 text-center text-xl font-bold text-[#8A2323]">ĐƠN ĐÃ HUỶ</div>
        ) : returned ? (
          <div className="mt-2 rounded-xl border-2 border-[#8A2323] p-3 text-center text-xl font-bold text-[#8A2323]">ĐƠN HOÀN HÀNG</div>
        ) : collect > 0 ? (
          <div className="mt-2 rounded-xl bg-navy p-2.5 text-center text-white print:[-webkit-print-color-adjust:exact] print:[print-color-adjust:exact]">
            <p className="text-[12px] tracking-wider">SHIPPER THU CỦA KHÁCH (COD)</p>
            <p className="text-[30px] font-bold leading-tight">{formatVnd(collect)}</p>
            {owed > 0 && shipToCollect > 0 && (
              <p className="text-[11px] opacity-90">
                Tiền hàng {formatVnd(owed)} + phí ship {formatVnd(shipToCollect)}
              </p>
            )}
          </div>
        ) : (
          <div className="mt-2 rounded-xl border-[2.5px] border-[#22612A] p-3 text-center text-[#22612A]">
            <p className="text-[24px] font-bold">✓ ĐÃ THANH TOÁN</p>
            <p className="text-[12px]">Shipper không thu tiền của khách{fee > 0 ? " · phí ship shop trả" : ""}</p>
          </div>
        )}
      </div>

      {/* đường gập */}
      <div className="relative border-t-[1.5px] border-dashed border-[#A0845E]">
        <span className="absolute -top-2.5 right-[8mm] bg-white px-1.5 text-[9.5px] text-[#A0845E]">✂ gập đôi tại đây</span>
      </div>

      {/* ---- NỬA DƯỚI: sản phẩm ---- */}
      <div className="or-half flex flex-col px-[9mm] pb-[6mm] pt-[6mm]">
        <p className="mb-1.5 text-center font-display text-base tracking-[0.15em] text-navy">HOÁ ĐƠN BÁN HÀNG</p>
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b-[1.5px] border-navy text-left text-[11px] text-navy">
              <th className="py-1 pr-1">Sản phẩm</th>
              <th className="py-1 text-center">SL</th>
              <th className="py-1 text-right">Đơn giá</th>
              <th className="py-1 text-right">Thành tiền</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-b border-cream align-top">
                <td className="py-1.5 pr-1">{it.description}</td>
                <td className="py-1.5 text-center">{it.quantity}</td>
                <td className="whitespace-nowrap py-1.5 text-right">{formatVnd(Number(it.unit_price))}</td>
                <td className="whitespace-nowrap py-1.5 text-right">
                  {formatVnd(Number(it.amount))}
                  {Number(it.discount) > 0 && <span className="block text-[10.5px] text-ink/50">đã giảm {formatVnd(Number(it.discount))}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1 flex justify-between text-[14px] font-bold text-navy">
          <span>Tổng tiền hàng</span>
          <span>{formatVnd(total)}</span>
        </p>
        <div className="text-[11.5px] text-ink/70">
          {payments.map((p) => (
            <p key={p.id} className="flex justify-between">
              <span>Đã trả – {METHOD_LABEL[p.method] ?? p.method}</span>
              <span>{formatVnd(Number(p.amount))}</span>
            </p>
          ))}
          {debtPayments.map((p) => (
            <p key={p.id} className="flex justify-between">
              <span>Đã thu thêm – {METHOD_LABEL[p.method] ?? p.method}</span>
              <span>{formatVnd(Number(p.amount))}</span>
            </p>
          ))}
          {owed > 0 && (
            <p className="flex justify-between">
              <span>Còn lại – shipper thu (COD)</span>
              <span>{formatVnd(owed)}</span>
            </p>
          )}
          {fee > 0 && (
            <p className="flex justify-between">
              <span>Phí ship ({customerPaysShip ? "khách trả" : "shop trả"})</span>
              <span>{formatVnd(fee)}</span>
            </p>
          )}
          {staff && <p className="mt-1">Nhân viên: {staff}</p>}
        </div>
        <p className="mt-auto text-center text-[12px] font-semibold text-navy">
          <span className="text-[#C9AD7F]">✦</span> Cám ơn quý khách đã tin tưởng và lựa chọn Moana Beauty{" "}
          <span className="text-[#C9AD7F]">✦</span>
        </p>
      </div>
    </div>
  );
}
