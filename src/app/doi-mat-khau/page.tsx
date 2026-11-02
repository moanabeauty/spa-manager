"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { vnError } from "@/lib/format";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 6) return setError("Mật khẩu cần ít nhất 6 ký tự.");
    setBusy(true);
    const { error } = await createClient().auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setError(vnError(error.message));
    router.replace("/dat-lich");
    router.refresh();
  }

  return (
    <div className="card mx-auto max-w-md p-6">
      <h1 className="mb-4 text-xl font-bold text-navy">Đặt mật khẩu mới</h1>
      <form onSubmit={onSubmit} className="space-y-4">
        <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Mật khẩu mới" autoComplete="new-password" />
        {error && <p className="rounded-xl bg-[#F6D5D5] px-4 py-3 text-sm text-[#8A2323]">{error}</p>}
        <button className="btn-primary w-full py-3" disabled={busy}>
          {busy ? "Đang lưu…" : "Lưu mật khẩu"}
        </button>
      </form>
    </div>
  );
}
