"use client";

// Âm "ting ting" tự tạo bằng Web Audio (không cần file âm thanh, không tốn dung lượng).
let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

/** iPhone chỉ cho phát âm sau khi người dùng chạm màn hình 1 lần: gọi hàm này ở lần chạm đầu tiên */
export function unlockChime() {
  const c = getCtx();
  if (c && c.state === "suspended") c.resume().catch(() => {});
}

function ding(c: AudioContext, at: number, freq: number) {
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.35, at + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.9);
  gain.connect(c.destination);
  // tiếng chuông: âm chính + hoạ âm cao cho "trong"
  for (const [f, v] of [[freq, 1], [freq * 2.76, 0.25], [freq * 5.4, 0.08]] as const) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = "sine";
    o.frequency.value = f;
    g.gain.value = v;
    o.connect(g).connect(gain);
    o.start(at);
    o.stop(at + 1);
  }
}

/** Kêu "ting ting" */
export function playChime() {
  const c = getCtx();
  if (!c) return;
  const go = () => {
    const t = c.currentTime + 0.02;
    ding(c, t, 1568); // Sol 6
    ding(c, t + 0.22, 2093); // Đô 7
  };
  if (c.state === "suspended") c.resume().then(go).catch(() => {});
  else go();
  if ("vibrate" in navigator) navigator.vibrate?.([120, 60, 120]);
}
