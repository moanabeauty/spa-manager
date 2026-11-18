// Dựng website tĩnh vào thư mục dist/ — chạy: node build.mjs
// Không cần cài thư viện nào (chỉ dùng Node 20+).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData } from './src/data.mjs';
import { SITE } from './src/site.mjs';
import { renderHome } from './src/pages/home.mjs';
import { renderAbout, newsPages, renderPrivacy, renderContact, render404 } from './src/pages/other.mjs';
import { catalogPages } from './src/pages/catalog.mjs';
import { productPages } from './src/pages/products.mjs';

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
  { path: '/ve-moana', html: renderAbout(buildId) },
  ...newsPages(data, buildId),
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
const indexed = pages.map((p) => p.path);
console.log(`${pages.length} trang`);

const today = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(OUT, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indexed
    .map((p) => `  <url><loc>${SITE.url}${p}</loc><lastmod>${today}</lastmod></url>`).join('\n')}\n</urlset>\n`);
fs.writeFileSync(path.join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE.url}/sitemap.xml\n`);

console.log(`Xong: ${fs.readdirSync(OUT).length} mục trong dist/`);
