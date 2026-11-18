// Đọc dữ liệu công khai từ app spa-manager (Supabase) lúc build.
// Chỉ dùng các hàm/bảng công khai: web_services, web_packages, web_products, promotions (show_online), posts (đã đăng).
// Nếu không kết nối được, dùng bản sao data/fallback.json để website vẫn build được.
import fs from 'node:fs';

const URL_ = process.env.SUPABASE_URL || 'https://gbkanpqajzfyyhlslxdj.supabase.co';
// Khoá publishable là khoá công khai (an toàn khi lộ), chỉ đọc được những gì RLS cho phép.
const KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_woVwiX6fwua-U5rTAQebHQ_xMDCn_33';

async function call(path, init = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: KEY, 'Content-Type': 'application/json', ...(init.headers || {}) },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}
const rpc = (fn) => call(`rpc/${fn}`, { method: 'POST', body: '{}' });

export async function loadData() {
  const fallback = JSON.parse(fs.readFileSync(new URL('../data/fallback.json', import.meta.url), 'utf8'));
  if (process.env.WEBSITE_OFFLINE === '1') return { ...fallback, promotions: [], posts: [], source: 'fallback' };
  try {
    const today = new Date().toISOString().slice(0, 10);
    const [services, packages, products, promotions, posts] = await Promise.all([
      rpc('web_services'),
      rpc('web_packages'),
      rpc('web_products'),
      call('promotions?select=id,name,description,kind,start_date,end_date,terms,sort_order&is_active=eq.true&show_online=eq.true&order=sort_order.asc.nullslast').catch(() => []),
      call('posts?select=id,kind,title,slug,summary,cover_url,published_at&is_published=eq.true&order=published_at.desc.nullslast&limit=6').catch(() => []),
    ]);
    return {
      services, packages, products,
      promotions: promotions.filter((p) => !p.end_date || p.end_date >= today),
      posts,
      source: 'supabase',
    };
  } catch (err) {
    console.warn('⚠ Không đọc được dữ liệu từ app, dùng bản sao data/fallback.json:', err.message);
    return { ...fallback, promotions: [], posts: [], source: 'fallback' };
  }
}
