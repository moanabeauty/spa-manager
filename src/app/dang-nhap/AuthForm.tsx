"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { vnError } from "@/lib/format";

type Tab = "login" | "signup" | "forgot";

export default function AuthForm({
  next,
  initialTab,
  linkError,
}: {
  next: string;
  initialTab: "login" | "signup";
  linkError: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    linkError ? "Link xác nhận đã hết hạn hoặc không hợp lệ. Vui lòng đăng nhập hoặc gửi lại." : null,
  );
  const [info, setInfo] = useState<string | null>(null);

  function switchTab(t: Tab) {
    setTab(t);
    setError(null);
    setInfo(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const supabase = createClient();
    const cleanEmail = email.trim().toLowerCase();

    if (tab === "signup") {
      const cleanPhone = phone.replace(/[\s.\-]/g, "").replace(/^\+84/, "0");
      if (fullName.trim().length < 2) return setError("Vui lòng nhập họ tên.");
      if (!/^0\d{9}$/.test(cleanPhone)) return setError("Số điện thoại cần 10 số, bắt đầu bằng 0.");
      if (password.length < 6) return setError("Mật khẩu cần ít nhất 6 ký tự.");
      setBusy(true);
      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          data: { full_name: fullName.trim(), phone: cleanPhone },
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      setBusy(false);
      if (error) return setError(vnError(error.message));
      if (data.session) {
        router.replace(next);
        router.refresh();
      } else if (data.user && data.user.identities && data.user.identities.length === 0) {
        setError("Email này đã có tài khoản. Hãy đăng nhập.");
      } else {
        setInfo("Đăng ký thành công! Vui lòng mở email và bấm link xác nhận để kích hoạt tài khoản.");
      }
      return;
    }

    if (tab === "forgot") {
      setBusy(true);
      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: `${window.location.origin}/auth/callback?next=/doi-mat-khau`,
      });
      setBusy(false);
      if (error) return setError(vnError(error.message));
      setInfo("Nếu email đã đăng ký, Moana đã gửi link đặt lại mật khẩu. Vui lòng kiểm tra hộp thư.");
      return;
    }

    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
    setBusy(false);
    if (error) return setError(vnError(error.message));
    router.replace(next);
    router.refresh();
  }

  const title = tab === "signup" ? "Tạo tài khoản" : tab === "forgot" ? "Quên mật khẩu" : "Đăng nhập";

  return (
    <div className="card p-6">
      {tab !== "forgot" && (
        <div className="mb-6 grid grid-cols-2 rounded-full bg-beige p-1 text-sm font-semibold">
          {(["login", "signup"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => switchTab(t)}
              className={`rounded-full py-2 transition ${tab === t ? "bg-navy text-white shadow" : "text-navy"}`}
            >
              {t === "login" ? "Đăng nhập" : "Đăng ký"}
            </button>
          ))}
        </div>
      )}
      <h1 className="mb-1 text-xl font-bold text-navy">{title}</h1>
      <p className="mb-5 text-sm text-ink/70">
        {tab === "signup"
          ? "Tạo tài khoản để đặt lịch online và theo dõi lịch hẹn của bạn."
          : tab === "forgot"
            ? "Nhập email đã đăng ký, Moana sẽ gửi link đặt lại mật khẩu."
            : "Chào mừng bạn quay lại Moana Beauty."}
      </p>

      <form onSubmit={onSubmit} className="space-y-4">
        {tab === "signup" && (
          <>
            <div>
              <label className="label" htmlFor="name">Họ và tên</label>
              <input id="name" className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" required />
            </div>
            <div>
              <label className="label" htmlFor="phone">Số điện thoại</label>
              <input id="phone" className="input" type="tel" inputMode="tel" placeholder="09xx xxx xxx" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" required />
            </div>
          </>
        )}
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" className="input" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </div>
        {tab !== "forgot" && (
          <div>
            <label className="label" htmlFor="pw">Mật khẩu</label>
            <input
              id="pw"
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={tab === "signup" ? "new-password" : "current-password"}
              minLength={6}
              required
            />
          </div>
        )}

        {error && <p className="rounded-xl bg-[#F6D5D5] px-4 py-3 text-sm text-[#8A2323]">{error}</p>}
        {info && <p className="rounded-xl bg-[#D6EDD8] px-4 py-3 text-sm text-[#22612A]">{info}</p>}

        <button className="btn-primary w-full py-3" disabled={busy}>
          {busy ? "Đang xử lý…" : tab === "signup" ? "Tạo tài khoản" : tab === "forgot" ? "Gửi link" : "Đăng nhập"}
        </button>
      </form>

      <div className="mt-4 text-center text-sm">
        {tab === "login" && (
          <button type="button" className="text-navy underline" onClick={() => switchTab("forgot")}>
            Quên mật khẩu?
          </button>
        )}
        {tab === "forgot" && (
          <button type="button" className="text-navy underline" onClick={() => switchTab("login")}>
            Quay lại đăng nhập
          </button>
        )}
      </div>
    </div>
  );
}
