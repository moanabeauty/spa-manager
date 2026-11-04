"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { todayVn, vnDateTime, vnError } from "@/lib/format";
import CustomerSearch from "@/components/CustomerSearch";
import { TIME_SLOTS } from "@/app/khuyen-mai/RegisterForm";

type PromoOpt = {
  id: string;
  name: string;
  branch_id: string | null;
  new_customers_only: boolean;
  show_online: boolean;
  left: number | null;
  summary: string;
  ended: boolean; // hết thời gian đăng ký (chỉ chủ / quản lý thấy)
};
type Cust = { id: string; full_name: string; phone: string | null };

/** Nhân viên đăng ký hộ khách gọi điện / đến quầy: đăng ký được xác nhận luôn */
export default function StaffRegisterForm({
  promotions,
  branches,
  defaultBranchId,
}: {
  promotions: PromoOpt[];
  branches: { id: string; name: string }[];
  defaultBranchId: string;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(false);
  const [customer, setCustomer] = useState<Cust | null>(null);
  const [promoId, setPromoId] = useState("");
  const [branchId, setBranchId] = useState(defaultBranchId);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const promo = promotions.find((p) => p.id === promoId);
  const branchOpts = promo?.branch_id ? branches.filter((b) => b.id === promo.branch_id) : branches;
  useEffect(() => {
    if (promo?.branch_id) setBranchId(promo.branch_id);
  }, [promo?.branch_id]);

  async function submit() {
    if (!customer || !promo) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("register_promotion", {
      p_promotion_id: promo.id,
      p_branch_id: branchId,
      p_preferred_at: date && time ? vnDateTime(date, time).toISOString() : null,
      p_note: note,
      p_customer_id: customer.id,
    });
    setBusy(false);
    if (error) return setError(vnError(error.message));
    setOkMsg(`Đã đăng ký "${promo.name}" cho ${customer.full_name} (đã xác nhận).`);
    setCustomer(null);
    setPromoId("");
    setDate("");
    setTime("");
    setNote("");
    router.refresh();
  }

  if (!open) {
    return (
      <div className="flex items-center gap-3">
        <button className="btn-outline" onClick={() => { setOpen(true); setOkMsg(null); }}>+ Đăng ký hộ khách</button>
        {okMsg && <span className="text-sm text-[#22612A]">✓ {okMsg}</span>}
      </div>
    );
  }

  return (
    <div className="card space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-navy">Đăng ký hộ khách</h2>
        <button className="text-ink/50" onClick={() => setOpen(false)}>✕</button>
      </div>
      {okMsg && <p className="rounded-lg bg-[#D6EDD8] px-3 py-2 text-[#22612A]">✓ {okMsg}</p>}

      {customer ? (
        <div className="flex items-center justify-between rounded-xl bg-cream px-3 py-2">
          <span>
            <b>{customer.full_name}</b> <span className="text-ink/60">{customer.phone}</span>
          </span>
          <button className="text-xs text-[#8A2323] underline" onClick={() => setCustomer(null)}>Đổi khách</button>
        </div>
      ) : (
        <div>
          <CustomerSearch
            label="Khách hàng (SĐT, mã KH hoặc tên)"
            onPick={(c) => {
              setCustomer({ id: c.id, full_name: c.full_name, phone: c.phone });
              setOkMsg(null);
            }}
            emptyHint={
              <>
                Chưa có khách này. Tạo hồ sơ ở trang <Link href="/quan-ly/tao-lich" className="text-navy underline">Tạo lịch</Link>.
              </>
            }
          />
        </div>
      )}

      <label className="block">
        <span className="label">Chương trình</span>
        <select className="input py-2" value={promoId} onChange={(e) => setPromoId(e.target.value)}>
          <option value="">— Chọn chương trình —</option>
          {promotions.map((p) => (
            <option key={p.id} value={p.id} disabled={p.left === 0}>
              {p.name}
              {p.left !== null ? ` (còn ${p.left} suất)` : ""}
              {!p.show_online ? " · chỉ tại quầy" : ""}
              {p.ended ? " · đã hết hạn đăng ký (chủ / quản lý duyệt)" : ""}
            </option>
          ))}
        </select>
        {promo && (
          <span className="mt-1 block text-xs text-ink/60">
            {promo.summary}
            {promo.new_customers_only ? " · chỉ khách lần đầu" : ""}
          </span>
        )}
      </label>

      <div className="flex flex-wrap gap-2">
        <select className="input w-auto flex-1 py-2" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
          {branchOpts.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <input type="date" min={todayVn()} className="input w-auto py-2" value={date} onChange={(e) => setDate(e.target.value)} />
        <select className="input w-28 py-2" value={time} onChange={(e) => setTime(e.target.value)}>
          <option value="">Giờ</option>
          {TIME_SLOTS.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>
      <input className="input py-2" placeholder="Ghi chú (không bắt buộc)" value={note} onChange={(e) => setNote(e.target.value)} />
      {error && <p className="text-[#8A2323]">{error}</p>}
      <div className="text-right">
        <button className="btn-primary" disabled={busy || !customer || !promo || !branchId || !!date !== !!time} onClick={submit}>
          {busy ? "Đang lưu…" : "Đăng ký & xác nhận"}
        </button>
      </div>
    </div>
  );
}
