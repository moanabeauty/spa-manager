import { SITE, BRANCHES, BRANDS, GROUPS, FEATURED, HOME_PRODUCTS } from '../site.mjs';
import { esc, page, zaloIcon } from '../layout.mjs';
import { niceName, prodSlug, svcSlug } from '../util.mjs';

const img = (name, alt, { cls = '', eager = false, sizes = '100vw' } = {}) =>
  `<img class="${cls}" src="/images/${name}.webp" alt="${esc(alt)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" sizes="${sizes}">`;


export function renderHome(data, buildId) {
  const services = data.services || [];

  const groups = GROUPS.map((g) => ({
    ...g,
    count: services.filter((s) => (s.category || '').startsWith(g.match)).length,
  })).filter((g) => g.count > 0);

  const featured = FEATURED.map((f) => {
    const list = services.filter((s) => (s.name_en || '').toUpperCase() === f.nameEn);
    if (!list.length) return null;
    const sub = list.length > 1 ? list.map((s) => s.name.replace(/^Peel căng bóng\s*(tức thì)?\s*–\s*/i, '')).join(' / ') : list[0].name;
    return { ...f, sub, href: list.length > 1 ? `/lieu-trinh#${f.slug}` : `/lieu-trinh/${svcSlug(list[0])}` };
  }).filter(Boolean);

  const products = (data.products || []);
  const picked = HOME_PRODUCTS.map((sku) => products.find((p) => p.sku === sku)).filter(Boolean);
  for (const p of products) { if (picked.length >= 4) break; if (!picked.includes(p)) picked.push(p); }

  const news = [
    ...(data.promotions || []).map((p) => ({ label: 'Ưu đãi', title: p.name, text: p.description, href: '/tin-tuc' })),
    ...(data.posts || []).map((p) => ({ label: p.kind === 'promotion' ? 'Ưu đãi' : 'Tin tức', title: p.title, text: p.summary, href: `/tin-tuc/${p.slug}`, cover: p.cover_url })),
  ].slice(0, 3);

  const body = `
<section class="hero">
  ${img('hero-cham-soc', 'Chuyên viên Moana chăm sóc da mặt cho khách', { cls: 'hero-img', eager: true })}
  <div class="hero-shade"></div>
  <div class="hero-text">
    <h1>Chăm sóc bằng sự thấu hiểu từng làn da</h1>
    <p>Spa chăm sóc vấn đề da kết hợp thư giãn, cùng dược mỹ phẩm châu Âu và Mỹ.</p>
    <div class="btn-row center">
      <a class="btn btn-light" href="${SITE.bookingUrl}">Đặt lịch chăm sóc</a>
      <a class="btn btn-outline-light" href="#ghe-tham">Nhắn Zalo để tư vấn</a>
    </div>
  </div>
</section>

<section class="wrap entries">
  <article class="entry">
    <div class="entry-img">${img('tu-van', 'Chuyên viên Moana trong buổi chăm sóc', { sizes: '(min-width: 900px) 33vw, 100vw' })}</div>
    <h2 class="h3">Tư vấn theo làn da</h2>
    <p>Mỗi buổi bắt đầu từ tình trạng và nhu cầu cụ thể của da bạn.</p>
    <a class="btn btn-outline" href="#ghe-tham">Nhắn Zalo</a>
  </article>
  <article class="entry">
    <div class="entry-img">${img('san-pham-br', 'Sản phẩm Biologique Recherche dùng tại Moana', { sizes: '(min-width: 900px) 33vw, 100vw' })}</div>
    <h2 class="h3">Cá nhân hoá từng bước</h2>
    <p>Liệu trình và sản phẩm được lựa chọn, điều chỉnh cho riêng bạn.</p>
    <a class="btn btn-outline" href="/lieu-trinh">Khám phá liệu trình</a>
  </article>
  <article class="entry">
    <div class="entry-img">${img('hoa-thu-gian', 'Hoa tươi trong không gian Moana', { sizes: '(min-width: 900px) 33vw, 100vw' })}</div>
    <h2 class="h3">Ưu đãi của Moana</h2>
    <p>Chương trình theo tháng và các dịp đặc biệt trong năm.</p>
    <a class="btn btn-outline" href="/tin-tuc">Xem ưu đãi</a>
  </article>
</section>

<section class="wrap section" id="lieu-trinh">
  <h2 class="h2 center">Liệu trình theo nhu cầu da</h2>
  <div class="grid-cards">
    ${groups.map((g) => `
    <a class="card" href="/lieu-trinh#${g.slug}">
      <span class="card-img">${img(g.image, g.title, { sizes: '(min-width: 1100px) 25vw, (min-width: 600px) 50vw, 100vw' })}</span>
      <span class="card-body">
        <span class="card-title">${esc(g.title)}</span>
        <span class="label">${esc(g.tags)}</span>
        <span class="card-count">${g.count} liệu trình</span>
      </span>
    </a>`).join('')}
    <a class="card card-navy" href="/lieu-trinh">
      <span class="card-title">Chưa biết chọn liệu trình nào?</span>
      <span>Moana tư vấn theo tình trạng da trước khi bắt đầu.</span>
      <span class="btn btn-outline-light">Xem tất cả liệu trình</span>
    </a>
  </div>
</section>

${featured.length ? `
<section class="wrap section pt-0" id="noi-bat">
  <h2 class="h2 center">Liệu trình nổi bật</h2>
  <div class="featured">
    <div class="featured-img">${img('noi-bat', 'Thao tác chăm sóc da mặt cùng sản phẩm Biologique Recherche', { sizes: '(min-width: 1000px) 50vw, 100vw' })}</div>
    <div class="featured-grid">
      ${featured.map((f) => `
      <a class="tile" href="${f.href}">
        <span class="label">${esc(f.group)}</span>
        <span class="tile-title">${esc(f.nameEn)}</span>
        <span class="tile-sub">${esc(f.sub)}</span>
        <span class="link">Xem chi tiết</span>
      </a>`).join('')}
    </div>
  </div>
  <div class="btn-row center mt">
    <a class="btn btn-outline" href="/lieu-trinh">Xem tất cả liệu trình</a>
    <a class="btn btn-outline" href="/combo">Xem các combo</a>
  </div>
</section>` : ''}

<section class="journey">
  <div class="wrap section">
    <h2 class="h2 center">Hành trình chăm sóc tại Moana</h2>
    <ol class="steps">
      <li><span class="step-no">01</span><span class="step-t">Tư vấn</span><span>Cùng bạn xác định điều làn da đang cần ưu tiên.</span></li>
      <li><span class="step-no">02</span><span class="step-t">Lựa chọn</span><span>Chọn các bước và sản phẩm phù hợp, giải thích rõ từng bước.</span></li>
      <li><span class="step-no">03</span><span class="step-t">Chăm sóc</span><span>Buổi chăm sóc trong không gian yên tĩnh, sạch sẽ.</span></li>
      <li><span class="step-no">04</span><span class="step-t">Theo dõi</span><span>Theo sát làn da sau mỗi buổi và điều chỉnh khi cần.</span></li>
    </ol>
  </div>
</section>

<section class="space">
  ${img('khong-gian', 'Giường chăm sóc trải khăn Biologique Recherche tại Moana', { cls: 'space-img' })}
  <div class="hero-shade"></div>
  <div class="space-text">
    <p class="eyebrow">Từ ${SITE.founded} · Cầu Giấy &amp; Long Biên</p>
    <h2>Một khoảng nghỉ cho làn da của bạn</h2>
    <p>Không gian yên tĩnh, sạch sẽ, chu đáo trong từng chi tiết chuẩn bị.</p>
    <a class="btn btn-outline-light" href="/ve-moana">Câu chuyện của Moana</a>
  </div>
</section>

<section class="wrap section center" id="san-pham">
  <h2 class="h2">Dược mỹ phẩm tại Moana</h2>
  <ul class="brands" aria-label="Các hãng dược mỹ phẩm Moana đang dùng">${BRANDS.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
  <div class="grid-products">
    ${picked.map((p) => `
    <a class="product" href="/san-pham/${prodSlug(p)}">
      <span class="product-img">${p.image_url ? `<img src="${esc(p.image_url)}" alt="${esc(niceName(p.name))}" loading="lazy">` : `<span class="product-ph" aria-hidden="true">BR</span>`}</span>
      <span class="product-body">
        <span class="label">Biologique Recherche</span>
        <span class="product-name">${esc(niceName(p.name))}</span>
        <span class="product-cap">${esc(p.capacity || '')}</span>
      </span>
    </a>`).join('')}
  </div>
  <div class="btn-row center mt">
    <a class="btn btn-outline" href="/san-pham">Xem sản phẩm Biologique Recherche</a>
    <a class="btn btn-solid" href="${BRANCHES[0].zalo}" rel="noopener">${zaloIcon} Hỏi mua qua Zalo</a>
  </div>
</section>

<section class="news" id="uu-dai">
  <div class="wrap section">
    <h2 class="h2 center">Ưu đãi &amp; Tin tức</h2>
    ${news.length ? `
    <div class="grid-news">
      ${news.map((n) => `
      <a class="news-card" href="${n.href}">
        ${n.cover ? `<span class="news-img"><img src="${esc(n.cover)}" alt="" loading="lazy"></span>` : ''}
        <span class="card-body">
          <span class="label">${esc(n.label)}</span>
          <span class="card-title">${esc(n.title)}</span>
          ${n.text ? `<span class="news-text">${esc(n.text)}</span>` : ''}
        </span>
      </a>`).join('')}
    </div>` : `
    <div class="news-empty">
      <p>Moana cập nhật ưu đãi theo tháng và các dịp đặc biệt trong năm. Nhắn Zalo để nhận thông tin mới nhất từ cơ sở gần bạn.</p>
      <div class="btn-row center">
        ${BRANCHES.map((b) => `<a class="btn btn-outline" href="${b.zalo}" rel="noopener">${zaloIcon} Zalo ${esc(b.name)}</a>`).join('\n        ')}
      </div>
    </div>`}
  </div>
</section>

<section class="wrap section" id="ghe-tham">
  <h2 class="h2 center">Ghé thăm Moana</h2>
  <div class="branches">
    ${BRANCHES.map((b) => `
    <article class="branch">
      <h3 class="h3">${esc(b.name)}</h3>
      <p>${esc(b.address)}</p>
      <p class="muted">${esc(SITE.hours)}</p>
      <div class="btn-row">
        <a class="btn btn-solid" href="tel:${b.phone}">Gọi ${esc(b.phoneLabel)}</a>
        <a class="btn btn-outline" href="${b.zalo}" rel="noopener">${zaloIcon} Zalo</a>
        <a class="btn btn-outline" href="${b.map}" rel="noopener">Chỉ đường</a>
        <a class="btn btn-outline" href="${b.facebook}" rel="noopener">Facebook</a>
      </div>
    </article>`).join('')}
  </div>
</section>`;

  return page({ path: '/', body, buildId, ld: true });
}
