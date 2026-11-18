import { SITE, BRANCHES, NAV_LEFT, NAV_RIGHT } from './site.mjs';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const navLink = (l, current) =>
  `<a href="${l.href}"${current === l.href ? ' aria-current="page"' : ''}>${esc(l.label)}</a>`;

const zaloIcon = `<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4h0A2.5 2.5 0 0 1 4 13.5z"/></svg>`;

function header(current) {
  return `
<div class="topbar">
  <div class="wrap topbar-in">
    <span>${esc(SITE.hours)}</span>
    ${BRANCHES.map((b) => `<a href="tel:${b.phone}">${esc(b.name)} ${esc(b.phoneLabel)}</a>`).join('\n    ')}
  </div>
</div>
<header class="site-header">
  <div class="wrap header-in">
    <nav class="nav nav-left" aria-label="Menu chính">
      ${NAV_LEFT.map((l) => navLink(l, current)).join('\n      ')}
    </nav>
    <a class="logo" href="/" aria-label="Moana Beauty — Trang chủ">
      <img src="/brand/logo-moana.png" alt="Moana Beauty" width="156" height="54">
    </a>
    <div class="nav nav-right">
      ${NAV_RIGHT.map((l) => navLink(l, current)).join('\n      ')}
      <a class="btn btn-solid btn-sm" href="${SITE.bookingUrl}">Đặt lịch</a>
    </div>
    <details class="nav-mobile">
      <summary aria-label="Mở menu"><span></span><span></span><span></span></summary>
      <nav aria-label="Menu">
        ${[...NAV_LEFT, ...NAV_RIGHT].map((l) => navLink(l, current)).join('\n        ')}
        <a class="btn btn-solid" href="${SITE.bookingUrl}">Đặt lịch</a>
      </nav>
    </details>
  </div>
</header>`;
}

function footer() {
  return `
<footer class="site-footer">
  <div class="wrap footer-cta">
    <p class="footer-title">Đặt lịch chăm sóc cùng Moana</p>
    <div class="btn-row center">
      <a class="btn btn-light" href="${SITE.bookingUrl}">Đặt lịch</a>
      ${BRANCHES.map((b) => `<a class="btn btn-outline-light" href="${b.zalo}" rel="noopener">${zaloIcon} Zalo ${esc(b.name)}</a>`).join('\n      ')}
    </div>
  </div>
  <div class="wrap footer-grid">
    <div class="footer-brand">
      <img src="/brand/logo-moana-light.png" alt="Moana Beauty" width="140" height="49">
      <p>Spa chăm sóc vấn đề da kết hợp thư giãn tại Hà Nội, từ ${SITE.founded}.</p>
    </div>
    <div>
      <p class="footer-h">Khám phá</p>
      <a href="/lieu-trinh">Liệu trình</a>
      <a href="/promotion">Promotion</a>
      <a href="/bang-gia">Bảng giá</a>
      <a href="/san-pham">Sản phẩm</a>
      <a href="/ve-moana">Về Moana</a>
      <a href="/beauty-vlog">Beauty Vlog</a>
    </div>
    <div>
      <p class="footer-h">Liên hệ</p>
      ${BRANCHES.map((b) => `<span>${esc(b.name)} · <a href="tel:${b.phone}">${esc(b.phoneLabel)}</a><br><small>${esc(b.address)}</small></span>`).join('\n      ')}
      <a href="mailto:${SITE.email}">${SITE.email}</a>
    </div>
    <div>
      <p class="footer-h">Theo dõi Moana</p>
      <a href="${SITE.instagram}" rel="noopener">Instagram</a>
      <a href="${SITE.tiktok}" rel="noopener">TikTok</a>
      ${BRANCHES.map((b) => `<a href="${b.facebook}" rel="noopener">Facebook ${esc(b.name)}</a>`).join('\n      ')}
    </div>
  </div>
  <div class="wrap footer-bottom">
    <span>© ${new Date().getFullYear()} Moana Beauty</span>
    <a href="/chinh-sach-bao-mat">Chính sách bảo mật</a>
  </div>
</footer>`;
}

function jsonLd() {
  return {
    '@context': 'https://schema.org',
    '@graph': BRANCHES.map((b) => ({
      '@type': 'BeautySalon',
      name: `Moana Beauty — ${b.name}`,
      url: SITE.url,
      telephone: `+84${b.phone.slice(1)}`,
      email: SITE.email,
      image: `${SITE.url}/images/og-moana.jpg`,
      address: { '@type': 'PostalAddress', streetAddress: b.street, addressLocality: b.district, addressRegion: 'Hà Nội', addressCountry: 'VN' },
      openingHours: 'Mo-Su 09:00-18:00',
      sameAs: [b.facebook, SITE.instagram, SITE.tiktok],
    })),
  };
}

export function page({ path = '/', title, description = SITE.description, body, buildId, noindex = false, ld = false }) {
  const fullTitle = title ? `${title} | Moana Beauty` : 'Moana Beauty — Chăm sóc bằng sự thấu hiểu từng làn da';
  const canonical = `${SITE.url}${path === '/' ? '/' : path}`;
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
${noindex ? '<meta name="robots" content="noindex">\n' : ''}<meta name="theme-color" content="#2B2D64">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Moana Beauty">
<meta property="og:locale" content="vi_VN">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${SITE.url}/images/og-moana.jpg">
<link rel="icon" href="/brand/icon-192.png" type="image/png">
<link rel="apple-touch-icon" href="/brand/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600&amp;display=swap">
<link rel="stylesheet" href="/assets/site.css?v=${buildId}">
${ld ? `<script type="application/ld+json">${JSON.stringify(jsonLd())}</script>\n` : ''}<script async src="https://www.googletagmanager.com/gtag/js?id=${SITE.gaId}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${SITE.gaId}');</script>
</head>
<body>
<a class="skip" href="#noi-dung">Bỏ qua menu</a>
${header(path)}
<main id="noi-dung">
${body}
</main>
${footer()}
</body>
</html>
`;
}

export { zaloIcon };
