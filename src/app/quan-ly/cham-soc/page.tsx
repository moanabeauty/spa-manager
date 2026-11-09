import { redirect } from "next/navigation";
import Link from "next/link";
import { fillPhones } from "@/lib/phones";
import { getCurrentUser } from "@/lib/supabase/server";
import { todayVn } from "@/lib/format";
import { REMINDER_KIND, shortDate } from "@/lib/crm";
import ReminderActions from "./ReminderActions";
import LapsedList, { type Lapsed } from "./LapsedList";

export const metadata = { title: "Chăm sóc lại – Moana Beauty" };

type Sp = { tab?: string; cn?: string; loai?: string; tuan?: string; lich?: string };
type Rem = {
  id: string;
  kind: string;
  title: string;
  note: string | null;
  due_date: string;
  status: string;
  result: string | null;
  done_at: string | null;
  branch_id: string | null;
  customers: { id: string; full_name: string; phone: string | null } | null;
  doer: { full_name: string | null } | null;
};

const TABS = [
  { key: "chua-quay-lai", label: "Chưa quay lại" },
  { key: "den-han", label: "Nhắc đến hạn" },
  { key: "sap-toi", label: "Sắp tới (14 ngày)" },
  { key: "da-xong", label: "Đã xử lý (30 ngày)" },
];

export default async function CarePage({ searchParams }: { searchParams: Promise<Sp> }) {
  const { supabase, profile } = await getCurrentUser();
  if (profile?.role === "marketing") redirect("/quan-ly/marketing"); // Marketing không xem khách hàng
  const role = profile?.role;
  if (role === "warehouse") return <p className="card text-sm">Trang này dành cho lễ tân, KTV, quản lý và chủ spa.</p>;
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.tab) ? sp.tab! : "chua-quay-lai";
  const today = todayVn();

  // tạo nhắc định kỳ (gói sắp hết hạn, lâu chưa đến, sinh nhật) – chạy lại không bị trùng
  await supabase.rpc("refresh_care_reminders");

  const { data: branchData } = await supabase.from("branches").select("id, name").eq("is_active", true).order("name");
  const branches = (branchData ?? []) as { id: string; name: string }[];
  const defaultBranch = role === "owner" || role === "manager" ? "" : profile?.branch_id ?? "";
  const cn = sp.cn === "all" ? "" : sp.cn && branches.some((b) => b.id === sp.cn) ? sp.cn : defaultBranch;
  const kind = sp.loai && REMINDER_KIND[sp.loai] ? sp.loai : "";

  if (tab === "chua-quay-lai") {
    const { data: lapsedData, error: lapsedErr } = await supabase.rpc("care_lapsed", { p_branch: cn || null });
    const { count: dueCount } = await supabase.from("care_reminders").select("id", { count: "exact", head: true }).eq("status", "open").lte("due_date", today);
    return (
      <div className="space-y-4">
        <Head />
        <Tabs tab={tab} dueCount={dueCount ?? 0} cn={sp.cn} />
        {lapsedErr && <p className="card text-sm text-[#8A2323]">{lapsedErr.message}</p>}
        <LapsedList
          rows={(lapsedData ?? []) as Lapsed[]}
          branches={branches}
          cn={cn}
          week={sp.tuan ?? "1"}
          showBooked={sp.lich === "1"}
        />
      </div>
    );
  }

  let query = supabase
    .from("care_reminders")
    .select("id, kind, title, note, due_date, status, result, done_at, branch_id, customers(id, full_name), doer:profiles!care_reminders_done_by_fkey(full_name)")
    .limit(300);
  if (tab === "den-han") query = query.eq("status", "open").lte("due_date", today).order("due_date");
  else if (tab === "sap-toi") query = query.eq("status", "open").gt("due_date", today).lte("due_date", todayVn(14)).order("due_date");
  else query = query.neq("status", "open").gte("done_at", new Date(Date.now() - 30 * 86400000).toISOString()).order("done_at", { ascending: false });
  if (cn) query = query.or(`branch_id.eq.${cn},branch_id.is.null`);
  if (kind) query = query.eq("kind", kind);
  const { data, error } = await query;
  const list = (data ?? []) as unknown as Rem[];
  await fillPhones(supabase, list.map((r) => r.customers));

  const { count: dueCount } = await supabase.from("care_reminders").select("id", { count: "exact", head: true }).eq("status", "open").lte("due_date", today);


  return (
    <div className="space-y-4">
      <Head />
      <Tabs tab={tab} dueCount={dueCount ?? 0} cn={sp.cn} />
      <p className="text-xs text-ink/60">
        Hệ thống tự nhắc: hỏi thăm sau buổi làm, mời quay lại theo chu kỳ từng dịch vụ, gói sắp hết hạn, khách còn buổi / số dư mà lâu chưa đến,
        sinh nhật. Gọi khách xong bấm <b>Đã liên hệ</b> và ghi kết quả. Khách quay lại làm dịch vụ thì nhắc “mời quay lại” tự đóng.
      </p>

      <form action="/quan-ly/cham-soc" className="card grid grid-cols-2 gap-2 p-3">
        <input type="hidden" name="tab" value={tab} />
        <select name="cn" defaultValue={cn || "all"} className="input py-2 text-sm">
          <option value="all">Cả 2 chi nhánh</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <select name="loai" defaultValue={kind} className="input py-2 text-sm">
          <option value="">Mọi loại nhắc</option>
          {Object.entries(REMINDER_KIND)
            .filter(([k]) => k !== "contact")
            .map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
        </select>
        <button className="btn-outline col-span-2 py-2">Lọc</button>
      </form>

      {error && <p className="card text-sm text-[#8A2323]">{error.message}</p>}
      {list.length === 0 && <p className="card text-sm text-ink/60">Không có nhắc nào.</p>}

      <ul className="space-y-2">
        {list.map((r) => {
          const late = r.status === "open" && r.due_date < today;
          return (
            <li key={r.id} className={`card p-4 ${late ? "border-[#E8B4B4]" : ""}`}>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className={`rounded-full px-2 py-0.5 font-medium ${REMINDER_KIND[r.kind]?.style}`}>{REMINDER_KIND[r.kind]?.label}</span>
                <span className={late ? "font-semibold text-[#8A2323]" : "text-ink/60"}>
                  {r.status === "open" ? (late ? `Quá hạn từ ${shortDate(r.due_date)}` : r.due_date === today ? "Hôm nay" : shortDate(r.due_date)) : `Xử lý ${shortDate(r.done_at)}`}
                </span>
                <span className="text-ink/50">{branches.find((b) => b.id === r.branch_id)?.name.replace("Moana ", "")}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
                <Link href={`/quan-ly/khach-hang?id=${r.customers?.id}`} className="font-semibold text-navy underline-offset-2 hover:underline">
                  {r.customers?.full_name}
                </Link>
                {r.customers?.phone && (
                  <a href={`tel:${r.customers.phone}`} className="rounded-full bg-[#D6EDD8] px-3 py-1 text-sm font-semibold text-[#22612A]">
                    📞 {r.customers.phone}
                  </a>
                )}
              </div>
              <p className="mt-1 text-sm">{r.title}</p>
              {r.note && <p className="text-xs text-ink/60">{r.note}</p>}
              {r.status !== "open" && (
                <p className="mt-1 text-xs text-ink/60">
                  {r.status === "skipped" ? "Bỏ qua" : "Xong"}
                  {r.result && `: ${r.result}`}
                  {r.doer?.full_name && ` · ${r.doer.full_name}`}
                </p>
              )}
              {r.status === "open" && (
                <>
                  <ReminderActions id={r.id} />
                  {r.customers?.phone && (
                    <Link href={`/quan-ly/tao-lich?sdt=${r.customers.phone}`} className="mt-2 inline-block text-xs font-semibold text-navy underline">
                      Tạo lịch hẹn cho khách
                    </Link>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Head() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-navy">Chăm sóc lại khách</h1>
      <p className="mt-1 text-sm text-ink/70">Khách lâu chưa quay lại và các nhắc gọi điện hỏi thăm.</p>
    </div>
  );
}

function Tabs({ tab, dueCount, cn }: { tab: string; dueCount: number; cn?: string }) {
  return (
    <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={`/quan-ly/cham-soc?${new URLSearchParams({ tab: t.key, ...(cn ? { cn } : {}) }).toString()}`}
          className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${tab === t.key ? "bg-navy text-white" : "bg-white text-navy ring-1 ring-beige-dark"}`}
        >
          {t.label}
          {t.key === "den-han" && dueCount ? ` (${dueCount})` : ""}
        </Link>
      ))}
    </div>
  );
}
