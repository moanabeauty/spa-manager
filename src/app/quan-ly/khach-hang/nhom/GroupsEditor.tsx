"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { vnError } from "@/lib/format";
import MoneyInput from "@/components/MoneyInput";
import type { CrmSettings, Group } from "@/lib/crm";

const COLORS = ["#DCE3F5", "#E6DDF5", "#D6EDD8", "#FFE8BA", "#F6D5D5", "#FDE2EF", "#ECECEC"];

export default function GroupsEditor({ groups, counts }: { groups: Group[]; counts: Record<string, number> }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; color: string; description: string }>({ name: "", color: COLORS[0], description: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setError(null);
    if (!name.trim()) return setError("Vui lòng nhập tên nhóm.");
    setBusy(true);
    const { error } = await createClient().from("customer_groups").insert({ name: name.trim(), color, sort_order: groups.length + 1 });
    setBusy(false);
    if (error) return setError(error.message.includes("duplicate") ? "Đã có nhóm tên này." : vnError(error.message));
    setName("");
    router.refresh();
  }

  async function save(id: string) {
    setError(null);
    if (!draft.name.trim()) return setError("Tên nhóm không được trống.");
    setBusy(true);
    const { error } = await createClient()
      .from("customer_groups")
      .update({ name: draft.name.trim(), color: draft.color, description: draft.description.trim() || null })
      .eq("id", id);
    setBusy(false);
    if (error) return setError(vnError(error.message));
    setEditing(null);
    router.refresh();
  }

  async function remove(g: Group) {
    if (!window.confirm(`Xoá nhóm "${g.name}"? Khách trong nhóm không bị xoá, chỉ bỏ gắn nhóm.`)) return;
    setBusy(true);
    const { error } = await createClient().from("customer_groups").delete().eq("id", g.id);
    setBusy(false);
    if (error) return setError(vnError(error.message));
    router.refresh();
  }

  return (
    <div className="card space-y-3">
      <h2 className="font-semibold text-navy">Nhóm tự tạo</h2>
      <ul className="divide-y divide-beige">
        {groups.map((g) => (
          <li key={g.id} className="py-2">
            {editing === g.id ? (
              <div className="space-y-2">
                <input className="input py-2" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                <input className="input py-2 text-sm" placeholder="Mô tả (không bắt buộc)" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
                <ColorPicker value={draft.color} onChange={(c) => setDraft({ ...draft, color: c })} />
                <div className="flex gap-2">
                  <button className="btn-primary py-1.5" disabled={busy} onClick={() => save(g.id)}>Lưu</button>
                  <button className="btn-ghost py-1.5" onClick={() => setEditing(null)}>Huỷ</button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 text-sm">
                <span>
                  <span className="rounded-full px-2.5 py-1 font-medium" style={{ background: g.color }}>{g.name}</span>
                  <a href={`/quan-ly/khach-hang?nhom=${g.id}`} className="ml-2 text-xs text-navy underline">{counts[g.id] ?? 0} khách</a>
                  {g.description && <span className="block text-xs text-ink/60">{g.description}</span>}
                </span>
                <span className="flex shrink-0 gap-1">
                  <button className="btn-ghost py-1" onClick={() => { setEditing(g.id); setDraft({ name: g.name, color: g.color, description: g.description ?? "" }); }}>Sửa</button>
                  <button className="btn-ghost py-1 text-[#8A2323]" disabled={busy} onClick={() => remove(g)}>Xoá</button>
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="space-y-2 border-t border-beige pt-3">
        <div className="flex gap-2">
          <input className="input py-2" placeholder="Tên nhóm mới" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn-primary shrink-0" disabled={busy} onClick={add}>+ Thêm</button>
        </div>
        <ColorPicker value={color} onChange={setColor} />
      </div>
      {error && <p className="text-sm text-[#8A2323]">{error}</p>}
    </div>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex gap-1.5">
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={c}
          onClick={() => onChange(c)}
          className={`h-7 w-7 rounded-full ${value === c ? "ring-2 ring-navy ring-offset-1" : "ring-1 ring-beige-dark"}`}
          style={{ background: c }}
        />
      ))}
    </div>
  );
}

export function CrmSettingsForm({ settings }: { settings: CrmSettings }) {
  const router = useRouter();
  const [s, setS] = useState<CrmSettings>({
    vip_spend_12m: Number(settings.vip_spend_12m ?? 30000000),
    inactive_days: Number(settings.inactive_days ?? 60),
    birthday_days_before: Number(settings.birthday_days_before ?? 7),
    package_expiry_days: Number(settings.package_expiry_days ?? 30),
    unlock_menu_by_card: settings.unlock_menu_by_card !== false,
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setMsg(null);
    if (!(s.inactive_days > 0) || !(s.package_expiry_days > 0) || s.birthday_days_before < 0) {
      return setMsg({ ok: false, text: "Số ngày phải lớn hơn 0." });
    }
    setBusy(true);
    const { error } = await createClient().rpc("save_crm_settings", { p_value: s });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: vnError(error.message) });
    setMsg({ ok: true, text: "Đã lưu cài đặt." });
    router.refresh();
  }

  const num = (k: "inactive_days" | "package_expiry_days" | "birthday_days_before") => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value.replace(/\D/g, "")) || 0;
    setS((x) => ({ ...x, [k]: v }) as CrmSettings);
  };

  return (
    <div className="card space-y-3">
      <h2 className="font-semibold text-navy">Cài đặt CRM (chủ spa)</h2>
      <label className="block text-sm">
        <span className="label">Khách VIP khi chi tiêu 12 tháng từ</span>
        <MoneyInput value={s.vip_spend_12m} onChange={(v) => setS({ ...s, vip_spend_12m: v })} />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          <span className="label">“Lâu chưa quay lại” sau (ngày)</span>
          <input className="input py-2" inputMode="numeric" value={s.inactive_days} onChange={num("inactive_days")} />
        </label>
        <label className="text-sm">
          <span className="label">Nhắc gói sắp hết hạn trước (ngày)</span>
          <input className="input py-2" inputMode="numeric" value={s.package_expiry_days} onChange={num("package_expiry_days")} />
        </label>
        <label className="text-sm">
          <span className="label">Nhắc sinh nhật trước (ngày)</span>
          <input className="input py-2" inputMode="numeric" value={s.birthday_days_before} onChange={num("birthday_days_before")} />
        </label>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={s.unlock_menu_by_card} onChange={(e) => setS({ ...s, unlock_menu_by_card: e.target.checked })} />
        <span>
          Khách đã nạp <b>thẻ tài khoản</b> cũng được xem toàn bộ menu online (bỏ chọn = chỉ khách đã mua gói combo).
        </span>
      </label>
      {msg && <p className={`text-sm ${msg.ok ? "text-[#22612A]" : "text-[#8A2323]"}`}>{msg.text}</p>}
      <button className="btn-primary" disabled={busy} onClick={save}>{busy ? "Đang lưu…" : "Lưu cài đặt"}</button>
    </div>
  );
}
