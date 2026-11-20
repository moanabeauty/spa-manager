// Trang Sản phẩm (danh sách có lọc + chi tiết từng sản phẩm). Mua qua Zalo, không có giỏ hàng.
import { SITE, BRANCHES, PRODUCT_CATS } from '../site.mjs';
import { esc, page, zaloIcon } from '../layout.mjs';
import { banner, crumbs, ctaBand, zaloButtons } from '../parts.mjs';
import { money, niceName, prodSlug, catLabel } from '../util.mjs';

const BRAND = 'Biologique Recherche';

function prepare(data) {
  const products = (data.products || []).map((p) => ({
    ...p, slug: prodSlug(p), nice: niceName(p.name), cat: p.category || 'KHÁC',
  }));
  const order = (c) => { const i = PRODUCT_CATS.findIndex((x) => x.key === c); return i < 0 ? 99 : i; };
  products.sort((a, b) => order(a.cat) - order(b.cat) || a.nice.localeCompare(b.nice, 'vi') || (a.retail_price || 0) - (b.retail_price || 0));
  const cats = [...new Set(products.map((p) => p.cat))].map((key) => ({
    key, label: catLabel(key), slug: prodSlug({ sku: catLabel(key) }), count: products.filter((p) => p.cat === key).length,
  }));
  return { products, cats };
}

const thumb = (p, eager = false) => p.image_url
  ? `<img src="${esc(p.image_url)}" alt="${esc(p.nice)}" ${eager ? '' : 'loading="lazy" '}decoding="async">`
  : `<span class="product-ph" aria-hidden="true">BR</span>`;

const card = (p, cats) => `
    <a class="product" href="/san-pham/${p.slug}" data-cat="${(cats.find((c) => c.key === p.cat) || {}).slug || ''}" data-q="${esc(`${p.nice} ${p.sku} ${p.capacity || ''}`.toLowerCase())}">
      <span class="product-img">${thumb(p)}</span>
      <span class="product-body">
        <span class="label">${esc(catLabel(p.cat))}</span>
        <span class="product-name">${esc(p.nice)}</span>
        <span class="product-cap">${esc(p.capacity || '')}</span>
        ${p.retail_price ? `<span class="product-price">${money(p.retail_price)}</span>` : ''}
      </span>
    </a>`;

function renderIndex(ctx, buildId) {
  const { products, cats } = ctx;
  const body = `${banner('Sản phẩm', `Các sản phẩm ${BRAND} (Pháp) bán lẻ tại Moana. Moana chưa bán hàng trực tuyến — bạn nhắn Zalo cơ sở gần nhất để được tư vấn cách dùng và đặt mua.`, { eyebrow: BRAND })}
<div class="wrap shop-tools">
  <div class="chips chips-filter" role="group" aria-label="Lọc theo loại sản phẩm" hidden>
    <button type="button" data-f="" aria-pressed="true">Tất cả <span>${products.length}</span></button>
    ${cats.map((c) => `<button type="button" data-f="${c.slug}" aria-pressed="false">${esc(c.label)} <span>${c.count}</span></button>`).join('\n    ')}
  </div>
  <label class="search" hidden><span class="sr">Tìm sản phẩm</span><input type="search" placeholder="Tìm theo tên hoặc mã sản phẩm" autocomplete="off"></label>
  <p class="muted shop-count" aria-live="polite"></p>
</div>
<section class="wrap section pt-0">
  <div class="grid-products grid-shop">${products.map((p) => card(p, cats)).join('')}
  </div>
  <p class="muted center shop-empty" hidden>Không tìm thấy sản phẩm phù hợp. Bạn có thể nhắn Zalo để Moana tư vấn.</p>
</section>
${ctaBand('Hỏi mua sản phẩm qua Zalo', 'Gửi tên hoặc mã sản phẩm cho Moana để được tư vấn cách dùng phù hợp với làn da của bạn.')}
<script>
(() => {
  const chips = document.querySelector('.chips-filter'), box = document.querySelector('.search'), input = box.querySelector('input');
  const items = [...document.querySelectorAll('.grid-shop .product')], count = document.querySelector('.shop-count'), empty = document.querySelector('.shop-empty');
  chips.hidden = false; box.hidden = false;
  let f = (location.hash.match(/^#loai-(.+)$/) || [])[1] || '';
  const apply = () => {
    const q = input.value.trim().toLowerCase(); let n = 0;
    for (const el of items) { const ok = (!f || el.dataset.cat === f) && (!q || el.dataset.q.includes(q)); el.hidden = !ok; if (ok) n++; }
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
    description: `${products.length} sản phẩm ${BRAND} bán lẻ tại Moana Beauty Hà Nội: Lotion P50, serum, kem dưỡng, mặt nạ, chăm sóc cơ thể và tóc. Tư vấn và đặt mua qua Zalo.`,
  });
}

function renderProduct(p, ctx, buildId) {
  const related = ctx.products.filter((x) => x.cat === p.cat && x !== p && x.nice !== p.nice).slice(0, 4);
  const sizes = ctx.products.filter((x) => x.nice === p.nice && x !== p);
  const cat = ctx.cats.find((c) => c.key === p.cat);
  const ld = {
    '@context': 'https://schema.org', '@type': 'Product', name: `${p.nice}${p.capacity ? ` ${p.capacity}` : ''}`, sku: p.sku,
    brand: { '@type': 'Brand', name: BRAND }, category: catLabel(p.cat),
    ...(p.image_url ? { image: [p.image_url, p.texture_image_url].filter(Boolean) } : {}),
    ...(p.web_description ? { description: p.web_description } : {}),
    ...(p.retail_price ? { offers: { '@type': 'Offer', price: Number(p.retail_price), priceCurrency: 'VND', availability: 'https://schema.org/InStoreOnly', url: `${SITE.url}/san-pham/${p.slug}` } } : {}),
  };
  const body = `${crumbs([{ href: '/san-pham', label: 'Sản phẩm' }, { href: `/san-pham#loai-${cat.slug}`, label: cat.label }, { label: p.nice }])}
<section class="wrap detail">
  ${p.texture_image_url && p.image_url ? `<div class="product-gallery">
    <div class="product-img product-detail-img">${thumb(p, true)}</div>
    <div class="product-img product-detail-img"><img src="${esc(p.texture_image_url)}" alt="${esc(`Kết cấu ${p.nice}`)}" loading="lazy" decoding="async"></div>
  </div>` : `<div class="detail-img product-img product-detail-img">${thumb(p, true)}</div>`}
  <div class="detail-text">
    <p class="label">${BRAND} · ${esc(catLabel(p.cat))}</p>
    <h1 class="detail-title">${esc(p.nice)}</h1>
    ${p.capacity ? `<p class="detail-sub">${esc(p.capacity)}</p>` : ''}
    ${p.retail_price ? `<p class="price-big">${money(p.retail_price)}</p><p class="muted small">Giá niêm yết tại Moana</p>` : ''}
    ${p.web_description ? `<div class="prose">${p.web_description.split(/\n+/).map((t) => `<p>${esc(t)}</p>`).join('')}</div>` : ''}
    ${sizes.length ? `<p>Dung tích khác: ${sizes.map((x) => `<a href="/san-pham/${x.slug}">${esc(x.capacity || x.sku)}</a>`).join(' · ')}</p>` : ''}
    <div class="buy-box">
      <p><strong>Mua tại Moana</strong></p>
      <p>Moana chưa bán hàng trực tuyến. Nhắn Zalo cơ sở gần bạn kèm mã sản phẩm <strong>${esc(p.sku)}</strong> để được tư vấn cách dùng và đặt mua.</p>
      <div class="btn-row">
        ${BRANCHES.map((b) => `<a class="btn btn-solid" href="${b.zalo}" rel="noopener">${zaloIcon} Zalo ${esc(b.name)}</a>`).join('\n        ')}
      </div>
    </div>
  </div>
</section>
${related.length ? `
<section class="wrap section">
  <h2 class="h2 center">${esc(catLabel(p.cat))} khác</h2>
  <div class="grid-products">${related.map((x) => card(x, ctx.cats)).join('')}
  </div>
  <div class="btn-row center mt"><a class="btn btn-outline" href="/san-pham">Xem tất cả sản phẩm</a></div>
</section>` : ''}
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`;
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
