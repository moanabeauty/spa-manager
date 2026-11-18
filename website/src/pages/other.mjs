import { SITE, BRANCHES } from '../site.mjs';
import { esc, page, zaloIcon } from '../layout.mjs';

// Các trang sẽ làm ở phần sau — tạm hiển thị khung + lối liên hệ, không cho Google lập chỉ mục.
export const STUBS = [
  { path: '/lieu-trinh', title: 'Liệu trình', intro: 'Danh sách liệu trình theo từng nhóm nhu cầu da đang được Moana hoàn thiện.' },
  { path: '/combo', title: 'Combo', intro: 'Các combo chăm sóc theo liệu trình dài hạn đang được Moana hoàn thiện.' },
  { path: '/bang-gia', title: 'Bảng giá', intro: 'Bảng giá liệu trình và combo đang được Moana cập nhật.' },
  { path: '/san-pham', title: 'Sản phẩm', intro: 'Danh mục sản phẩm Biologique Recherche bán lẻ tại Moana đang được hoàn thiện.' },
  { path: '/ve-moana', title: 'Về Moana', intro: `Moana Beauty — spa chăm sóc vấn đề da kết hợp thư giãn tại Hà Nội từ ${SITE.founded}.` },
  { path: '/tin-tuc', title: 'Ưu đãi & Tin tức', intro: 'Ưu đãi theo tháng và tin tức của Moana sẽ được đăng tại đây.' },
  { path: '/chinh-sach-bao-mat', title: 'Chính sách bảo mật', intro: 'Nội dung chính sách bảo mật đang được Moana hoàn thiện.' },
];

const contactBlock = () => `
  <div class="branches">
    ${BRANCHES.map((b) => `
    <article class="branch">
      <h2 class="h3">${esc(b.name)}</h2>
      <p>${esc(b.address)}</p>
      <p class="muted">${esc(SITE.hours)}</p>
      <div class="btn-row">
        <a class="btn btn-solid" href="tel:${b.phone}">Gọi ${esc(b.phoneLabel)}</a>
        <a class="btn btn-outline" href="${b.zalo}" rel="noopener">${zaloIcon} Zalo</a>
        <a class="btn btn-outline" href="${b.map}" rel="noopener">Chỉ đường</a>
        <a class="btn btn-outline" href="${b.facebook}" rel="noopener">Facebook</a>
      </div>
    </article>`).join('')}
  </div>`;

const banner = (title, intro) => `
<section class="page-head">
  <div class="wrap">
    <h1>${esc(title)}</h1>
    ${intro ? `<p>${esc(intro)}</p>` : ''}
  </div>
</section>`;

export function renderStub(s, buildId) {
  const body = `${banner(s.title, s.intro)}
<section class="wrap section pt-0 center">
  <p class="muted">Trong lúc chờ, bạn có thể nhắn Zalo hoặc gọi Moana để được tư vấn.</p>
  <div class="btn-row center mt-s">
    <a class="btn btn-solid" href="${SITE.bookingUrl}">Đặt lịch</a>
    ${BRANCHES.map((b) => `<a class="btn btn-outline" href="${b.zalo}" rel="noopener">${zaloIcon} Zalo ${esc(b.name)}</a>`).join('\n    ')}
  </div>
</section>`;
  return page({ path: s.path, title: s.title, body, buildId, noindex: true });
}

export function renderContact(buildId) {
  const body = `${banner('Liên hệ', 'Moana mở cửa 9:00 – 18:00 tất cả các ngày, trừ ngày lễ Tết. Bạn có thể đặt lịch trực tuyến, gọi điện hoặc nhắn Zalo cho cơ sở gần nhất.')}
<section class="wrap section pt-0">
  ${contactBlock()}
  <p class="center mt">Email: <a href="mailto:${SITE.email}">${SITE.email}</a></p>
  <div class="btn-row center mt-s"><a class="btn btn-solid" href="${SITE.bookingUrl}">Đặt lịch trực tuyến</a></div>
</section>`;
  return page({ path: '/lien-he', title: 'Liên hệ', description: 'Địa chỉ, hotline, Zalo và giờ mở cửa hai cơ sở Moana Beauty: 67 Lưu Quang Vũ (Cầu Giấy) và 109 Nguyễn Sơn (Long Biên), Hà Nội.', body, buildId, ld: true });
}

export function render404(buildId) {
  const body = `${banner('Không tìm thấy trang', 'Trang bạn tìm có thể đã được đổi địa chỉ khi Moana làm mới website.')}
<section class="wrap section pt-0 center">
  <div class="btn-row center">
    <a class="btn btn-solid" href="/">Về trang chủ</a>
    <a class="btn btn-outline" href="/lieu-trinh">Liệu trình</a>
    <a class="btn btn-outline" href="/lien-he">Liên hệ</a>
  </div>
</section>`;
  return page({ path: '/404', title: 'Không tìm thấy trang', body, buildId, noindex: true });
}
