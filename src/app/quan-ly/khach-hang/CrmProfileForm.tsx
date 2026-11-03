"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { normalizePhone, vnError } from "@/lib/format";
import { SKIN_TYPES, SOURCES, type CrmProfile, type Group } from "@/lib/crm";

type Cust = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  birthday: string | null;
  gender: string | null;
  note: string | null;
  home_branch_id: string | null;
};

/** Hồ sơ khách: thông tin liên hệ + hồ sơ da / nguồn khách (chỉ nhân viên thấy) + nhóm khách */
export default function CrmProfileForm({
  customer,
  crm,
  groups,
  memberOf,
  branches,
}: {
  customer: Cust;
  crm: CrmProfile | null;
  groups: Group[];
  memberOf: string[];
  branches: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [c, setC] = useState<Cust>(customer);
  const [p, setP] = useState({
    address: crm?.address ?? "",
    source: crm?.source ?? "",
    skin_type: crm?.skin_type ?? "",
    skin_concerns: crm?.skin_concerns ?? "",
    health_note: crm?.health_note ?? "",
    internal_note: crm?.internal_note ?? "",
  });
  const [inGroups, setInGroups] = useState<string[]>(memberOf);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function toggleGroup(id: string) {
    setMsg(null);
    const supabase = createClient();
    const on = inGroups.includes(id);
    setInGroups((g) => (on ? g.filter((x) => x !== id) : [...g, id]));
    const { error } = on
      ? await supabase.from("customer_group_members").delete().eq("group_id", id).eq("customer_id", customer.id)
      : await supabase.from("customer_group_members").insert({ group_id: id, customer_id: customer.id });
    if (error) {
      setInGroups((g) => (on ? [...g, id] : g.filter((x) => x !== id)));
      return setMsg({ ok: false, text: vnError(error.message) });
    }
    router.refresh();
  }

  async function save() {
    setMsg(null);
    if (!c.full_name.trim()) return setMsg({ ok: false, text: "Vui lòng nhập họ tên." });
    setBusy(true);
    const supabase = createClient();
    const phone = c.phone?.trim() ? normalizePhone(c.phone) : null;
    const { error: e1 } = await supabase
      .from("customers")
      .update({
        full_name: c.full_name.trim(),
        phone,
        email: c.email?.trim() || null,
        birthday: c.birthday || null,
        gender: c.gender || null,
        note: c.note?.trim() || null,
        home_branch_id: c.home_branch_id || null,
      })
      .eq("id", customer.id);
    if (e1) {
      setBusy(false);
      return setMsg({ ok: false, text: vnError(e1.message) });
    }
    const clean = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v.trim() || null]));
    const { error: e2 } = await supabase.from("customer_crm").upsert({ customer_id: customer.id, ...clean }, { onConflict: "customer_id" });
    setBusy(false);
    if (e2) return setMsg({ ok: false, text: vnError(e2.message) });
    setMsg({ ok: true, text: "Đã lưu hồ sơ." });
    router.refresh();
  }

  const set = (k: keyof typeof p) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setP((x) => ({ ...x, [k]: e.target.value }));

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-navy">Hồ sơ khách</h2>
        <button className="btn-ghost py-1.5" onClick={() => setOpen((v) => !v)}>{open ? "Thu gọn" : "Xem / sửa"}</button>
      </div>

      <div className="mt-2">
        <p className="mb-1 text-xs text-ink/60">Nhóm khách (bấm để gắn / bỏ)</p>
        <div className="flex flex-wrap gap-1.5">
          {groups.length === 0 && <span className="text-xs text-ink/50">Chưa có nhóm nào. Chủ / quản lý tạo nhóm ở “Nhóm & cài đặt”.</span>}
          {groups.map((g) => {
            const on = inGroups.includes(g.id);
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => toggleGroup(g.id)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${on ? "ring-2 ring-navy" : "opacity-60 ring-1 ring-beige-dark"}`}
                style={{ background: on ? g.color : "white" }}
              >
                {on ? "✓ " : "+ "}
                {g.name}
              </button>
            );
          })}
        </div>
      </div>

      {!open && (crm?.skin_type || crm?.skin_concerns || crm?.source) && (
        <p className="mt-3 text-sm text-ink/70">
          {[crm?.skin_type, crm?.skin_concerns, crm?.source && `Nguồn: ${crm.source}`].filter(Boolean).join(" · ")}
        </p>
      )}

      {open && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="label">Họ tên</span>
            <input className="input py-2" value={c.full_name} onChange={(e) => setC({ ...c, full_name: e.target.value })} />
          </label>
          <label className="text-sm">
            <span className="label">Số điện thoại</span>
            <input className="input py-2" inputMode="tel" value={c.phone ?? ""} onChange={(e) => setC({ ...c, phone: e.target.value })} />
          </label>
          <label className="text-sm">
            <span className="label">Email</span>
            <input className="input py-2" type="email" value={c.email ?? ""} onChange={(e) => setC({ ...c, email: e.target.value })} />
          </label>
          <label className="text-sm">
            <span className="label">Ngày sinh</span>
            <input className="input py-2" type="date" value={c.birthday ?? ""} onChange={(e) => setC({ ...c, birthday: e.target.value })} />
          </label>
          <label className="text-sm">
            <span className="label">Giới tính</span>
            <select className="input py-2" value={c.gender ?? ""} onChange={(e) => setC({ ...c, gender: e.target.value })}>
              <option value="">—</option>
              <option value="Nữ">Nữ</option>
              <option value="Nam">Nam</option>
              <option value="Khác">Khác</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="label">Chi nhánh hay đến</span>
            <select className="input py-2" value={c.home_branch_id ?? ""} onChange={(e) => setC({ ...c, home_branch_id: e.target.value })}>
              <option value="">—</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="label">Địa chỉ</span>
            <input className="input py-2" value={p.address} onChange={set("address")} />
          </label>
          <label className="text-sm">
            <span className="label">Nguồn khách</span>
            <input className="input py-2" list="crm-sources" value={p.source} onChange={set("source")} placeholder="Facebook, giới thiệu…" />
            <datalist id="crm-sources">{SOURCES.map((s) => <option key={s} value={s} />)}</datalist>
          </label>
          <label className="text-sm">
            <span className="label">Loại da</span>
            <input className="input py-2" list="crm-skin" value={p.skin_type} onChange={set("skin_type")} />
            <datalist id="crm-skin">{SKIN_TYPES.map((s) => <option key={s} value={s} />)}</datalist>
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="label">Tình trạng da / mong muốn</span>
            <textarea className="input py-2" rows={2} value={p.skin_concerns} onChange={set("skin_concerns")} placeholder="vd: mụn ẩn vùng cằm, muốn sáng da" />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="label">Lưu ý sức khoẻ / dị ứng</span>
            <textarea className="input py-2" rows={2} value={p.health_note} onChange={set("health_note")} placeholder="Hiện nổi bật trên hồ sơ để KTV chú ý" />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="label">Ghi chú nội bộ (khách không thấy)</span>
            <textarea className="input py-2" rows={2} value={p.internal_note} onChange={set("internal_note")} />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="label">Ghi chú trên lịch hẹn (lễ tân thấy khi tạo lịch)</span>
            <textarea className="input py-2" rows={2} value={c.note ?? ""} onChange={(e) => setC({ ...c, note: e.target.value })} />
          </label>
          <div className="sm:col-span-2">
            <button className="btn-primary" disabled={busy} onClick={save}>{busy ? "Đang lưu…" : "Lưu hồ sơ"}</button>
          </div>
        </div>
      )}
      {!open && crm?.internal_note && <p className="mt-2 text-xs text-ink/60">Ghi chú nội bộ: {crm.internal_note}</p>}
      {msg && <p className={`mt-2 text-sm ${msg.ok ? "text-[#22612A]" : "text-[#8A2323]"}`}>{msg.text}</p>}
    </div>
  );
}
