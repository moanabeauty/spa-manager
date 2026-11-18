// Khối giao diện dùng lại ở các trang con.
import { SITE, BRANCHES } from './site.mjs';
import { esc, zaloIcon } from './layout.mjs';

export const banner = (title, intro, { eyebrow = '' } = {}) => `
<section class="page-head">
  <div class="wrap">
    ${eyebrow ? `<p class="eyebrow">${esc(eyebrow)}</p>` : ''}
    <h1>${esc(title)}</h1>
    ${intro ? `<p>${esc(intro)}</p>` : ''}
  </div>
</section>`;

// [{href,label}, ...] — mục cuối là trang hiện tại
export const crumbs = (items) => `
<nav class="crumbs wrap" aria-label="Đường dẫn">
  <a href="/">Trang chủ</a>${items.map((c, i) => i === items.length - 1
    ? ` <span aria-hidden="true">/</span> <span aria-current="page">${esc(c.label)}</span>`
    : ` <span aria-hidden="true">/</span> <a href="${c.href}">${esc(c.label)}</a>`).join('')}
</nav>`;

export const zaloButtons = (cls = 'btn btn-outline', prefix = 'Zalo ') =>
  BRANCHES.map((b) => `<a class="${cls}" href="${b.zalo}" rel="noopener">${zaloIcon} ${esc(prefix)}${esc(b.name)}</a>`).join('\n      ');

// Dải kêu gọi cuối trang: đặt lịch + Zalo hai cơ sở
export const ctaBand = (title = 'Nhắn Moana để được tư vấn theo tình trạng da', text = 'Moana tư vấn trước mỗi buổi để chọn liệu trình phù hợp với làn da của bạn.') => `
<section class="cta-band">
  <div class="wrap center">
    <h2 class="h2">${esc(title)}</h2>
    <p class="muted">${esc(text)}</p>
    <div class="btn-row center">
      <a class="btn btn-solid" href="${SITE.bookingUrl}">Đặt lịch chăm sóc</a>
      ${zaloButtons()}
    </div>
  </div>
</section>`;
