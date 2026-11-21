// Dựng website tĩnh vào thư mục dist/ — chạy: node build.mjs
// Không cần cài thư viện nào (chỉ dùng Node 20+).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData } from './src/data.mjs';
import { SITE } from './src/site.mjs';
import { renderHome } from './src/pages/home.mjs';
import { renderAbout, vlogPages, renderPrivacy, renderContact, render404 } from './src/pages/other.mjs';
import { catalogPages } from './src/pages/catalog.mjs';
import { productPages } from './src/pages/products.mjs';
import { INDEXNOW_KEY, STATE_FILE, pageHash, loadPreviousState, diffState, submitIndexNow, markUnsent } from './src/indexnow.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, 'dist');
const buildId = Date.now().toString(36);

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'public'), OUT, { recursive: true });
fs.cpSync(path.join(ROOT, 'src/assets'), path.join(OUT, 'assets'), { recursive: true });

const write = (urlPath, html) => {
  // cleanUrls: /lieu-trinh -> dist/lieu-trinh.html
  const file = urlPath === '/' ? 'index.html' : `${urlPath.slice(1)}.html`;
  const full = path.join(OUT, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, html);
};

const data = await loadData();
console.log(`Dữ liệu (${data.source}): ${data.services.length} liệu trình, ${data.packages.length} combo, ${data.products.length} sản phẩm, ${data.promotions.length} ưu đãi, ${data.posts.length} bài viết`);

const pages = [
  { path: '/', html: renderHome(data, buildId) },
  ...catalogPages(data, buildId).pages,
  ...productPages(data, buildId),
  { path: '/ve-moana', html: renderAbout(data, buildId) },
  ...vlogPages(data, buildId),
  { path: '/lien-he', html: renderContact(buildId) },
  { path: '/chinh-sach-bao-mat', html: renderPrivacy(buildId) },
];
const seen = new Set();
for (const p of pages) {
  if (seen.has(p.path)) throw new Error(`Trùng đường dẫn: ${p.path}`);
  seen.add(p.path);
  write(p.path, p.html);
}
write('/404', render404(buildId));
// Dữ liệu Google (layout.mjs › SPECIALTIES) trỏ cố định tới trang Acne Tweezer — báo nếu tên trong app đổi làm đổi đường dẫn.
if (!seen.has('/lieu-trinh/kiem-soat-mun-chuyen-sau')) console.warn('⚠ Không còn trang /lieu-trinh/kiem-soat-mun-chuyen-sau — sửa SPECIALTIES trong src/layout.mjs');
const indexed = pages.map((p) => p.path);
console.log(`${pages.length} trang`);

const today = new Date().toISOString().slice(0, 10);

// IndexNow + lastmod: so với bản đang chạy trên moanabeauty.vn (xem src/indexnow.mjs)
const prev = await loadPreviousState(SITE.url);
const goodData = data.source === 'supabase';
const { state, changed, removed } = goodData
  ? diffState(prev, Object.fromEntries(pages.map((p) => [p.path, pageHash(p.html, buildId)])), today)
  : { state: prev || { pages: {} }, changed: [], removed: [] }; // dữ liệu dự phòng → không coi là thay đổi thật
fs.writeFileSync(path.join(OUT, `${INDEXNOW_KEY}.txt`), INDEXNOW_KEY);

fs.writeFileSync(path.join(OUT, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indexed
    .map((p) => `  <url><loc>${SITE.url}${p}</loc><lastmod>${state.pages[p]?.lastmod || today}</lastmod></url>`).join('\n')}\n</urlset>\n`);
fs.writeFileSync(path.join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE.url}/sitemap.xml\n`);

const toSubmit = [...changed, ...removed];
console.log(`IndexNow: ${prev ? 'so với bản đang chạy' : 'chưa có bản trước'} → ${changed.length} trang mới/đổi, ${removed.length} trang bị xoá`);
if (!goodData) console.log('IndexNow: bỏ qua (đang dùng dữ liệu dự phòng)');
else if (process.env.VERCEL_ENV !== 'production') console.log('IndexNow: bỏ qua (không phải bản Production)');
else if (toSubmit.length) {
  try {
    await submitIndexNow(SITE.url, toSubmit);
    console.log(`IndexNow: đã gửi ${toSubmit.length} đường dẫn`);
  } catch (err) {
    console.warn('⚠ IndexNow: gửi không được, lần deploy sau sẽ gửi lại (website vẫn deploy bình thường):', err.message);
    markUnsent(state, changed, removed, today);
  }
}
state.updated = new Date().toISOString();
fs.writeFileSync(path.join(OUT, STATE_FILE), JSON.stringify(state));

console.log(`Xong: ${fs.readdirSync(OUT).length} mục trong dist/`);
