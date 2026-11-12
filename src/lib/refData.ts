import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createClient as createPlainClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";

// Dữ liệu tham chiếu ít thay đổi – trước đây ~35 trang tự hỏi lại Supabase mỗi lần mở.
// Nay lấy 1 lần rồi giữ trong bộ nhớ đệm của Vercel (dùng chung mọi người dùng, mọi trang).

export type Branch = {
  id: string;
  name: string;
  address: string | null;
  max_per_slot: number | null;
  latitude: number | null;
  longitude: number | null;
  is_active: boolean;
};

const COLS = "id, name, address, max_per_slot, latitude, longitude, is_active";

// Chi nhánh là dữ liệu công khai (ai cũng đọc được) nên dùng client không gắn phiên đăng nhập
const cachedBranches = unstable_cache(
  async (): Promise<Branch[]> => {
    const sb = createPlainClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await sb.from("branches").select(COLS).order("name");
    if (error) throw error; // lỗi thì không lưu vào bộ nhớ đệm
    return (data ?? []) as Branch[];
  },
  ["branches-v1"],
  { revalidate: 3600, tags: ["branches"] },
);

/** Tất cả chi nhánh (kể cả đã ngừng), sắp theo tên – dùng chung trong 1 lần tải trang */
const loadBranches = cache(async (): Promise<Branch[]> => {
  try {
    return await cachedBranches();
  } catch {
    const supabase = await createClient();
    const { data } = await supabase.from("branches").select(COLS).order("name");
    return (data ?? []) as Branch[];
  }
});

/** Chi nhánh đang hoạt động — trả về dạng { data } giống truy vấn Supabase để thay thế trực tiếp */
export async function activeBranches(): Promise<{ data: Branch[] }> {
  return { data: (await loadBranches()).filter((b) => b.is_active) };
}

/** Tất cả chi nhánh — dạng { data } */
export async function allBranches(): Promise<{ data: Branch[] }> {
  return { data: await loadBranches() };
}

/** Cài đặt lương / giờ làm (app_settings.payroll): layout và trang cùng cần, chỉ hỏi 1 lần mỗi lần tải trang */
export const payrollSettings = cache(async () => {
  const supabase = await createClient();
  return supabase.from("app_settings").select("value").eq("key", "payroll").maybeSingle();
});
