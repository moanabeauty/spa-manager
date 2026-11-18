// Hàm dùng chung cho các trang.
import { WEB_NAMES, PRODUCT_CATS } from './site.mjs';
import { esc } from './layout.mjs';

// "Cấp ẩm cơ bản" -> "cap-am-co-ban"
export const slugify = (s) =>
  String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// 850000 -> "850.000đ"
export const money = (n) => (n == null || n === '' ? '' : `${Number(n).toLocaleString('vi-VN')}đ`);

// Viết hoa chữ cái đầu mỗi từ cho tên sản phẩm BR (dữ liệu trong app có chỗ viết hoa hết).
export const niceName = (s) =>
  String(s).toLowerCase().replace(/(^|[\s'’(-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
    .replace(/\b(Vip|Msr|Pigm|Ac|Rl|Vg|P50\w?|O2|Pto|Mc110|Ph|Spf|Ii|Iii)\b/gi, (m) => m.toUpperCase());

// Chuẩn hoá câu chữ theo guideline thương hiệu khi hiển thị trên web (không sửa dữ liệu trong app).
export const webText = (s) =>
  String(s ?? '')
    .replace(/Điều trị/g, 'Chăm sóc').replace(/điều trị/g, 'chăm sóc')
    .replace(/Photo ?Skin/gi, 'PhotoSKin');

// Tên tiếng Việt hiển thị của liệu trình (cho phép đổi riêng trên web qua WEB_NAMES).
export const svcName = (s) => webText(WEB_NAMES[(s.name_en || '').toUpperCase()] || s.name);

// "GLOW PEELING" -> "Glow Peeling" (giữ nguyên các chữ viết tắt như MTS, BR, CVS, MC110)
export const titleEn = (s) =>
  String(s || '').toLowerCase().replace(/(^|[\s'’(-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
    .replace(/\b(Mts|Cvs|Mc110|Vip|O2|Br|Rf)\b/gi, (m) => m.toUpperCase());

export const svcSlug = (s) => slugify(svcName(s));
export const pkgSlug = (p) => slugify(p.name);
export const prodSlug = (p) => slugify(p.sku);

export const catLabel = (c) => (PRODUCT_CATS.find((x) => x.key === c) || { label: niceName(c || 'Khác') }).label;

export const img = (name, alt, { cls = '', eager = false, sizes = '100vw' } = {}) =>
  `<img class="${cls}" src="/images/${name}.webp" alt="${esc(alt)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" sizes="${sizes}">`;

// Văn bản nhiều dòng (bài viết, điều khoản) -> các đoạn <p>, giữ an toàn HTML.
export const paragraphs = (text) =>
  String(text || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('\n');

export const fmtDate = (d) => {
  if (!d) return '';
  const [y, m, day] = String(d).slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
};
