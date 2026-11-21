// Trang Sản phẩm (danh sách có lọc + chi tiết từng sản phẩm). Mua qua Zalo, không có giỏ hàng.
import { SITE, BRANCHES, PRODUCT_CATS } from '../site.mjs';
import { esc, page, zaloIcon } from '../layout.mjs';
import { banner, crumbs, ctaBand, zaloButtons } from '../parts.mjs';
import { money, niceName, prodSlug, catLabel } from '../util.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BRAND = 'Biologique Recherche';
const IMG_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../public/images/san-pham');
const hasFile = (name) => { try { return fs.existsSync(path.join(IMG_DIR, name)); } catch { return false; } };
// Ảnh nền phẳng kiểu BR: public/images/san-pham/<MÃ>-phang.webp (bot Grok dựng). Chưa có thì dùng ảnh chai hiện tại.
const ACCENT_EVERY = 6; // cứ 5 ô nền phẳng thì 1 ô giữ ảnh nền màu (điểm nhấn)

const capNum = (c) => parseFloat(String(c || '').replace(',', '.')) || 0;

function prepare(data) {
  const products = (data.products || []).map((p) => {
    const local = hasFile(`${p.sku}-chai.webp`) ? `/images/san-pham/${p.sku}-chai.webp` : null;
    const localTex = hasFile(`${p.sku}-texture.webp`) ? `/images/san-pham/${p.sku}-texture.webp` : null;
    const img = p.image_url || local;
    return {
      ...p, slug: prodSlug(p), nice: niceName(p.name), cat: p.category || 'KHÁC',
      img, tex: p.texture_image_url || localTex,
      flat: hasFile(`${p.sku}-phang.webp`) ? `/images/san-pham/${p.sku}-phang.webp` : null,
    };
  });
  const order = (c) => { const i = PRODUCT_CATS.findIndex((x) => x.key === c); return i < 0 ? 99 : i; };
  products.sort((a, b) => order(a.cat) - order(b.cat) || a.nice.localeCompare(b.nice, 'vi') || capNum(a.capacity) - capNum(b.capacity) || (a.retail_price || 0) - (b.retail_price || 0));
  // Gộp các dung tích của cùng một sản phẩm thành 1 dòng (1 ô trên trang danh sách).
  const lines = [];
  for (const p of products) {
    const key = `${p.cat}|${p.nice.toLowerCase()}`;
    let line = lines.find((l) => l.key === key);
    if (!line) { line = { key, nice: p.nice, cat: p.cat, sizes: [] }; lines.push(line); }
    line.sizes.push(p); p.line = line;
  }
  for (const l of lines) {
    // Ô đại diện: bản 150 ml khi có 3 size, bản lớn hơn khi có 2 size (kem: 50 ml).
    l.main = l.sizes[Math.min(1, l.sizes.length - 1)];
    l.tex = l.sizes.map((x) => x.tex).find(Boolean) || null;
  }
  const cats = [...new Set(lines.map((l) => l.cat))].map((key) => ({
    key, label: catLabel(key), slug: prodSlug({ sku: catLabel(key) }), count: lines.filter((l) => l.cat === key).length,
  }));
  return { products, lines, cats };
}

const imgTag = (src, alt, { eager = false, cls = '' } = {}) => src
  ? `<img${cls ? ` class="${cls}"` : ''} src="${esc(src)}" alt="${esc(alt)}" ${eager ? '' : 'loading="lazy" '}decoding="async">`
  : '';
const ph = `<span class="product-ph" aria-hidden="true">BR</span>`;

// Ô sản phẩm kiểu BR: ảnh vuông + tên. Ô điểm nhấn dùng ảnh nền màu; ô thường dùng ảnh nền phẳng.
const tile = (l, cats, i) => {
  const m = l.main, accent = (i % ACCENT_EVERY) === ACCENT_EVERY - 1;
  const flat = m.flat || m.img;
  return `
    <a class="br-tile${accent ? ' is-accent' : ''}${m.flat ? ' has-flat' : ''}" href="/san-pham/${m.slug}" data-cat="${(cats.find((c) => c.key === l.cat) || {}).slug || ''}" data-q="${esc(`${l.nice} ${l.sizes.map((x) => `${x.sku} ${x.capacity || ''}`).join(' ')}`.toLowerCase())}">
      <span class="br-tile-img">${m.img ? `${imgTag(flat, l.nice, { cls: 'img-flat' })}${m.flat ? imgTag(m.img, l.nice, { cls: 'img-accent' }) : ''}${l.tex ? imgTag(l.tex, `Kết cấu ${l.nice}`, { cls: 'img-tex' }) : ''}` : ph}</span>
      <span class="br-tile-name">${esc(l.nice)}</span>
    </a>`;
};

// Ô nhỏ cho "sản phẩm khác" ở trang chi tiết.
const card = (l, cats) => tile(l, cats, 0);

function renderIndex(ctx, buildId) {
  const { lines, cats } = ctx;
  const body = `${banner('Sản phẩm', `Các sản phẩm ${BRAND} (Pháp) bán lẻ tại Moana. Moana chưa bán hàng trực tuyến — bạn nhắn Zalo cơ sở gần nhất để được tư vấn cách dùng và đặt mua.`, { eyebrow: BRAND })}
<div class="wrap shop-tools">
  <div class="chips chips-filter" role="group" aria-label="Lọc theo loại sản phẩm" hidden>
    <button type="button" data-f="" aria-pressed="true">Tất cả <span>${lines.length}</span></button>
    ${cats.map((c) => `<button type="button" data-f="${c.slug}" aria-pressed="false">${esc(c.label)} <span>${c.count}</span></button>`).join('\n    ')}
  </div>
  <label class="search" hidden><span class="sr">Tìm sản phẩm</span><input type="search" placeholder="Tìm theo tên hoặc mã sản phẩm" autocomplete="off"></label>
  <p class="muted shop-count" aria-live="polite"></p>
</div>
<section class="wrap section pt-0">
  <div class="br-grid grid-shop">${lines.map((l, i) => tile(l, cats, i)).join('')}
  </div>
  <p class="muted center shop-empty" hidden>Không tìm thấy sản phẩm phù hợp. Bạn có thể nhắn Zalo để Moana tư vấn.</p>
</section>
${ctaBand('Hỏi mua sản phẩm qua Zalo', 'Gửi tên hoặc mã sản phẩm cho Moana để được tư vấn cách dùng phù hợp với làn da của bạn.')}
<script>
(() => {
  const chips = document.querySelector('.chips-filter'), box = document.querySelector('.search'), input = box.querySelector('input');
  const items = [...document.querySelectorAll('.grid-shop .br-tile')], count = document.querySelector('.shop-count'), empty = document.querySelector('.shop-empty');
  chips.hidden = false; box.hidden = false;
  let f = (location.hash.match(/^#loai-(.+)$/) || [])[1] || '';
  const apply = () => {
    const q = input.value.trim().toLowerCase(); let n = 0;
    for (const el of items) { const ok = (!f || el.dataset.cat === f) && (!q || el.dataset.q.includes(q)); el.hidden = !ok; if (ok) { n++; el.classList.toggle('is-accent', n % ${ACCENT_EVERY} === 0); } }
    for (const b of chips.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.f === f));
    count.textContent = n + ' sản phẩm'; empty.hidden = n > 0;
  };
  chips.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; f = b.dataset.f; history.replaceState(null, '', f ? '#loai-' + f : location.pathname); apply(); });
  input.addEventListener('input', apply);
  apply();
})();
</script>`;
  return page({
    path: '/san-pham', title: `Sản phẩm ${BRAND}`, body, buildId,
    description: `${lines.length} sản phẩm ${BRAND} bán lẻ tại Moana Beauty Hà Nội: Lotion P50, serum, kem dưỡng, mặt nạ, chăm sóc cơ thể và tóc. Tư vấn và đặt mua qua Zalo.`,
  });
}

function renderProduct(p, ctx, buildId) {
  const line = p.line, sizes = line.sizes;
  const related = ctx.lines.filter((l) => l.cat === p.cat && l !== line).slice(0, 4);
  const cat = ctx.cats.find((c) => c.key === p.cat);
  const ld = {
    '@context': 'https://schema.org', '@type': 'Product', name: `${p.nice}${p.capacity ? ` ${p.capacity}` : ''}`, sku: p.sku,
    brand: { '@type': 'Brand', name: BRAND }, category: catLabel(p.cat),
    ...(p.img ? { image: [p.img, p.tex].filter(Boolean) } : {}),
    ...(p.web_description ? { description: p.web_description } : {}),
    ...(p.retail_price ? { offers: { '@type': 'Offer', price: Number(p.retail_price), priceCurrency: 'VND', availability: 'https://schema.org/InStoreOnly', url: `${SITE.url}/san-pham/${p.slug}` } } : {}),
  };
  // Dữ liệu từng size cho nút chọn dung tích (đổi ảnh, giá, mã, đường dẫn ngay trên trang).
  const sizeData = sizes.map((x) => ({
    sku: x.sku, slug: x.slug, cap: x.capacity || x.sku, price: x.retail_price ? money(x.retail_price) : '',
    img: x.img || '', desc: x.web_description || '',
  }));
  const slides = [p.img, line.tex].filter(Boolean);
  const body = `${crumbs([{ href: '/san-pham', label: 'Sản phẩm' }, { href: `/san-pham#loai-${cat.slug}`, label: cat.label }, { label: p.nice }])}
<section class="wrap br-detail">
  <div class="br-gallery" data-n="${slides.length}">
    <div class="br-slides">${slides.length ? slides.map((src, i) => `<div class="br-slide${i ? '' : ' is-on'}">${imgTag(src, i ? `Kết cấu ${p.nice}` : p.nice, { eager: !i, cls: i ? '' : 'js-main-img' })}</div>`).join('') : `<div class="br-slide is-on">${ph}</div>`}</div>
    ${slides.length > 1 ? `<button type="button" class="br-arrow br-prev" aria-label="Ảnh trước" hidden>‹</button><button type="button" class="br-arrow br-next" aria-label="Ảnh tiếp">›</button>
    <div class="br-progress" aria-hidden="true"><span style="width:${100 / slides.length}%"></span></div>` : ''}
  </div>
  <div class="br-info">
    <h1 class="br-title">${esc(p.nice)}</h1>
    <p class="br-tags">${esc(BRAND)} <span>/</span> ${esc(catLabel(p.cat))}</p>
    ${sizes.length > 1 ? `<fieldset class="br-sizes">
      <legend class="sr">Chọn dung tích</legend>
      ${sizes.map((x) => `<label><input type="radio" name="size" value="${esc(x.sku)}"${x === p ? ' checked' : ''}><span>${esc(x.capacity || x.sku)}</span></label>`).join('\n      ')}
    </fieldset>` : (p.capacity ? `<p class="br-sizes br-sizes-one"><span class="is-on">${esc(p.capacity)}</span></p>` : '')}
    ${p.retail_price ? `<p class="br-price"><span class="js-price">${money(p.retail_price)}</span> <span class="muted small">· giá niêm yết tại Moana</span></p>` : ''}
    <p class="muted small br-sku">Mã sản phẩm: <span class="js-sku">${esc(p.sku)}</span></p>
    <div class="btn-row br-buy">
      ${BRANCHES.map((b) => `<a class="btn btn-solid" href="${b.zalo}" rel="noopener">${zaloIcon} Hỏi mua · ${esc(b.name)}</a>`).join('\n      ')}
    </div>
    <p class="muted small">Moana chưa bán hàng trực tuyến. Nhắn Zalo cơ sở gần bạn kèm mã sản phẩm để được tư vấn cách dùng và đặt mua.</p>
    <div class="br-acc">
      <details open><summary>Mô tả</summary><div class="prose js-desc">${p.web_description ? p.web_description.split(/\n+/).map((t) => `<p>${esc(t)}</p>`).join('') : `<p>${esc(p.nice)} — sản phẩm ${esc(catLabel(p.cat).toLowerCase())} của ${BRAND} (Pháp), bán lẻ tại Moana Beauty Hà Nội. Nhắn Zalo để chuyên viên Moana tư vấn cách dùng phù hợp với làn da của bạn.</p>`}</div></details>
      <details><summary>Mua tại Moana</summary><div class="prose">${BRANCHES.map((b) => `<p><strong>${esc(b.name)}</strong> — ${esc(b.address || '')}${b.phone ? ` · <a href="tel:${esc(b.phone)}">${esc(b.phoneLabel || b.phone)}</a>` : ''}</p>`).join('')}</div></details>
    </div>
  </div>
</section>
${related.length ? `
<section class="wrap section">
  <h2 class="h2 center">${esc(catLabel(p.cat))} khác</h2>
  <div class="br-grid br-grid-related">${related.map((l) => card(l, ctx.cats)).join('')}
  </div>
  <div class="btn-row center mt"><a class="btn btn-outline" href="/san-pham">Xem tất cả sản phẩm</a></div>
</section>` : ''}
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
<script>
(() => {
  const g = document.querySelector('.br-gallery'); const slides = [...g.querySelectorAll('.br-slide')];
  const prev = g.querySelector('.br-prev'), next = g.querySelector('.br-next'), bar = g.querySelector('.br-progress span');
  let i = 0;
  const go = (n) => { i = Math.max(0, Math.min(slides.length - 1, n)); slides.forEach((s, k) => s.classList.toggle('is-on', k === i));
    if (prev) { prev.hidden = i === 0; next.hidden = i === slides.length - 1; bar.style.transform = 'translateX(' + (i * 100) + '%)'; } };
  if (prev) { prev.onclick = () => go(i - 1); next.onclick = () => go(i + 1); }
  const sizes = ${JSON.stringify(sizeData).replace(/</g, '\\u003c')};
  const box = document.querySelector('.br-sizes'); if (!box || !box.querySelector('input')) return;
  const set = (sel, v) => { const el = document.querySelector(sel); if (el && v != null) el.textContent = v; };
  box.addEventListener('change', (e) => {
    const s = sizes.find((x) => x.sku === e.target.value); if (!s) return;
    set('.js-price', s.price); set('.js-sku', s.sku);
    const img = document.querySelector('.js-main-img'); if (img && s.img) img.src = s.img;
    if (s.desc) document.querySelector('.js-desc').innerHTML = s.desc.split(/\\n+/).map((t) => '<p>' + t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]) + '</p>').join('');
    go(0); history.replaceState(null, '', '/san-pham/' + s.slug);
  });
})();
</script>`;
  return page({
    path: `/san-pham/${p.slug}`, title: `${p.nice}${p.capacity ? ` ${p.capacity}` : ''} — ${BRAND}`, body, buildId,
    description: `${p.nice}${p.capacity ? ` ${p.capacity}` : ''} — ${BRAND}, ${catLabel(p.cat).toLowerCase()}${p.retail_price ? `, giá niêm yết ${money(p.retail_price)}` : ''}. Tư vấn và đặt mua qua Zalo tại Moana Beauty Hà Nội.`,
  });
}

export function productPages(data, buildId) {
  const ctx = prepare(data);
  return [
    { path: '/san-pham', html: renderIndex(ctx, buildId) },
    ...ctx.products.map((p) => ({ path: `/san-pham/${p.slug}`, html: renderProduct(p, ctx, buildId) })),
  ];
}
