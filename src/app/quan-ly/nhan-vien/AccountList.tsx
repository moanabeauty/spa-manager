"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ROLE_LABEL, normalizeText, vnError } from "@/lib/format";

export type Account = {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  role: string;
  branch_id: string | null;
  is_active: boolean;
  created_at: string;
  last_sign_in_at: string | null;
  extra_roles: string[] | null;
};

const ASSIGNABLE = ["receptionist", "technician", "warehouse", "marketing", "manager", "customer"] as const;
const NEEDS_BRANCH = new Set(["receptionist", "technician", "warehouse", "marketing"]);
/** Vai trò có thể kiêm nhiệm thêm */
const EXTRA = ["technician", "warehouse", "marketing", "receptionist", "manager"] as const;

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

const ROLE_STYLE: Record<string, string> = {
  owner: "bg-navy text-white",
  manager: "bg-[#E6DDF5] text-[#4B2D7A]",
  receptionist: "bg-[#DCE3F5] text-navy",
  technician: "bg-[#D6EDD8] text-[#22612A]",
  warehouse: "bg-[#FFE8BA] text-[#7A5600]",
  marketing: "bg-[#F3DCE6] text-[#7A2350]",
  customer: "bg-[#ECECEC] text-[#555]",
};

export default function AccountList({
  accounts,
  branches,
  myId,
}: {
  accounts: Account[];
  branches: { id: string; name: string }[];
  myId: string;
}) {
  const [tab, setTab] = useState<"staff" | "customer">("staff");
  const [query, setQuery] = useState("");
  const staffCount = accounts.filter((a) => a.role !== "customer").length;

  const list = useMemo(() => {
    const q = normalizeText(query.trim());
    return accounts.filter((a) => {
      if (q) return normalizeText(`${a.full_name ?? ""} ${a.email ?? ""} ${a.phone ?? ""}`).includes(q);
      return tab === "staff" ? a.role !== "customer" : a.role === "customer";
    });
  }, [accounts, tab, query]);

  return (
    <div className="space-y-3">
      <input
        className="input"
        placeholder="Tìm theo tên, email hoặc SĐT (tìm trong tất cả tài khoản)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {!query.trim() && (
        <div className="flex gap-2">
          {([
            ["staff", `Nhân viên (${staffCount})`],
            ["customer", `Tài khoản khách (${accounts.length - staffCount})`],
          ] as const).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setTab(v)}
              className={`rounded-full px-4 py-2 text-sm font-semibold ${tab === v ? "bg-navy text-white" : "bg-white text-navy ring-1 ring-beige-dark"}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {list.length === 0 && <p className="card text-sm text-ink/60">Không có tài khoản nào.</p>}
      {list.map((a) => (
        <AccountRow key={a.id} account={a} branches={branches} isMe={a.id === myId} />
      ))}
    </div>
  );
}

function AccountRow({ account: a, branches, isMe }: { account: Account; branches: { id: string; name: string }[]; isMe: boolean }) {
  const router = useRouter();
  const [role, setRole] = useState(a.role);
  const [branch, setBranch] = useState(a.branch_id ?? "");
  const savedExtra = (a.extra_roles ?? []).filter((r) => r !== a.role);
  const [extra, setExtra] = useState<string[]>(savedExtra);
  const extraNow = role === "customer" ? [] : extra.filter((r) => r !== role);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const editable = !isMe && a.role !== "owner";
  const dirty = role !== a.role || (branch || null) !== a.branch_id || !sameSet(extraNow, savedExtra);

  async function save() {
    setMsg(null);
    if ([role, ...extraNow].some((r) => NEEDS_BRANCH.has(r)) && !branch)
      return setMsg({ ok: false, text: "Vui lòng chọn chi nhánh." });
    setSaving(true);
    const supabase = createClient();
    if (role !== a.role || (branch || null) !== a.branch_id) {
      const { error } = await supabase.rpc("set_user_role", {
        target_user: a.id,
        new_role: role,
        new_branch: role === "customer" ? null : branch || null,
      });
      if (error) {
        setSaving(false);
        return setMsg({ ok: false, text: vnError(error.message) });
      }
    }
    const { error } = await supabase.rpc("set_user_extra_roles", { target_user: a.id, p_roles: extraNow });
    setSaving(false);
    if (error) return setMsg({ ok: false, text: vnError(error.message) });
    setMsg({ ok: true, text: "Đã lưu." });
    router.refresh();
  }

  async function toggleActive() {
    const verb = a.is_active ? "Khoá" : "Mở khoá";
    if (!window.confirm(`${verb} tài khoản ${a.full_name ?? a.email}?`)) return;
    setSaving(true);
    const { error } = await createClient().rpc("set_user_active", { target_user: a.id, active: !a.is_active });
    setSaving(false);
    if (error) return setMsg({ ok: false, text: vnError(error.message) });
    router.refresh();
  }

  return (
    <div className={`card p-4 ${a.is_active ? "" : "opacity-60"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">
            {a.full_name ?? "(chưa có tên)"} {isMe && <span className="text-xs font-normal text-ink/50">(bạn)</span>}
          </p>
          <p className="truncate text-sm text-ink/70">{a.email}</p>
          {a.phone && <p className="text-sm text-ink/70">{a.phone}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${ROLE_STYLE[a.role] ?? ""}`}>{ROLE_LABEL[a.role] ?? a.role}</span>
          {savedExtra.map((r) => (
            <span key={r} className={`rounded-full px-3 py-0.5 text-[11px] font-semibold ${ROLE_STYLE[r] ?? ""}`}>
              + {ROLE_LABEL[r] ?? r}
            </span>
          ))}
          {!a.is_active && <span className="text-xs font-semibold text-[#8A2323]">Đã khoá</span>}
          {a.role !== "customer" && (
            <span className="text-xs text-ink/50">{branches.find((b) => b.id === a.branch_id)?.name ?? "Mọi chi nhánh"}</span>
          )}
        </div>
      </div>

      {editable && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-beige pt-3">
          <span className="w-full text-xs font-semibold text-ink/60">Vai trò chính</span>
          <select className="input w-auto flex-1 py-2 text-sm" value={role} onChange={(e) => setRole(e.target.value)}>
            {ASSIGNABLE.map((r) => (
              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
            ))}
          </select>
          {role !== "customer" && (
            <select className="input w-auto flex-1 py-2 text-sm" value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value="">{[role, ...extraNow].some((r) => NEEDS_BRANCH.has(r)) ? "— Chọn chi nhánh —" : "Mọi chi nhánh"}</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          )}
          {role !== "customer" && (
            <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-1">
              <span className="w-full text-xs font-semibold text-ink/60">Kiêm nhiệm thêm (người này tự chuyển vai trò trên app)</span>
              {EXTRA.filter((r) => r !== role).map((r) => (
                <label key={r} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={extra.includes(r)}
                    onChange={(e) => setExtra((x) => (e.target.checked ? [...x, r] : x.filter((y) => y !== r)))}
                  />
                  {ROLE_LABEL[r]}
                </label>
              ))}
            </div>
          )}
          <button className="btn-primary py-2" disabled={!dirty || saving} onClick={save}>
            {saving ? "…" : "Lưu"}
          </button>
          <button className="btn-ghost py-2 text-[#8A2323]" disabled={saving} onClick={toggleActive}>
            {a.is_active ? "Khoá" : "Mở khoá"}
          </button>
          {msg && <p className={`w-full text-xs ${msg.ok ? "text-[#22612A]" : "text-[#8A2323]"}`}>{msg.text}</p>}
        </div>
      )}
    </div>
  );
}
