// IndexNow: báo cho Bing (và Yandex, Naver, Seznam…) biết trang nào vừa đổi, để họ vào đọc lại ngay
// thay vì chờ tự quét sitemap. Google không dùng IndexNow (Google vẫn đọc sitemap.xml).
//
// Cách chạy (tự động trong build.mjs, chỉ khi deploy Production trên Vercel):
// 1. Mỗi trang có 1 "dấu vân tay" (hash) nội dung, lưu ở /indexnow-state.json cùng ngày sửa cuối (lastmod).
// 2. Lần build sau tải bản state đang chạy trên moanabeauty.vn, so sánh → biết trang mới / đổi / bị xoá.
// 3. Gửi danh sách đó lên IndexNow. Trang không đổi giữ nguyên lastmod trong sitemap.xml.
// Khoá công khai (không phải mật khẩu): file public/<KEY>.txt phải chứa đúng KEY.
import crypto from 'node:crypto';

export const INDEXNOW_KEY = 'cc8187c3892153dc97a21f4f05d7cbf7';
export const STATE_FILE = 'indexnow-state.json';
const STATE_VERSION = 2; // tăng số này để buộc gửi lại toàn bộ ở lần deploy sau
const ENDPOINT = 'https://api.indexnow.org/indexnow';

// buildId đổi mỗi lần build (dùng làm ?v= cho CSS) → bỏ ra trước khi tính hash để trang không bị coi là "đổi".
export const pageHash = (html, buildId) =>
  crypto.createHash('sha1').update(html.split(buildId).join('')).digest('hex').slice(0, 16);

// State của bản đang chạy trên tên miền chính. Lỗi / chưa có → null.
export async function loadPreviousState(siteUrl) {
  try {
    const res = await fetch(`${siteUrl}/${STATE_FILE}`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const json = await res.json();
    return json && json.v === STATE_VERSION && typeof json.pages === 'object' ? json : null;
  } catch {
    return null;
  }
}

// current: { path: hash }. Trả về state mới + danh sách đường dẫn cần báo.
export function diffState(prev, current, today) {
  const old = prev?.pages || {};
  const pages = {};
  const changed = [];
  for (const [p, h] of Object.entries(current)) {
    const before = old[p];
    if (before && before.h === h) pages[p] = before;
    else {
      pages[p] = { h, lastmod: today };
      changed.push(p);
    }
  }
  const removed = Object.keys(old).filter((p) => !(p in current));
  return { state: { v: STATE_VERSION, pages }, changed, removed };
}

// Gửi lỗi → đánh dấu để lần deploy sau gửi lại (trang đổi: hash 'unsent'; trang xoá: giữ lại dạng 'gone').
export function markUnsent(state, changed, removed, today) {
  for (const p of changed) state.pages[p] = { ...state.pages[p], h: 'unsent' };
  for (const p of removed) state.pages[p] = { h: 'gone', lastmod: today };
}

export async function submitIndexNow(siteUrl, paths) {
  const host = new URL(siteUrl).host;
  const urlList = paths.map((p) => `${siteUrl}${p}`);
  for (let i = 0; i < urlList.length; i += 10000) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host,
        key: INDEXNOW_KEY,
        keyLocation: `${siteUrl}/${INDEXNOW_KEY}.txt`,
        urlList: urlList.slice(i, i + 10000),
      }),
      signal: AbortSignal.timeout(20000),
    });
    // 200 = đã nhận; 202 = đã nhận, đang kiểm tra khoá (bình thường ở lần gửi đầu tiên)
    if (res.status !== 200 && res.status !== 202) throw new Error(`HTTP ${res.status} ${await res.text().catch(() => '')}`.trim());
  }
}
