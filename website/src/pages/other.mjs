// Trang Về Moana, Ưu đãi & Tin tức (+ bài viết), Chính sách bảo mật, Liên hệ, 404.
import { SITE, BRANCHES, BRANDS } from '../site.mjs';
import { esc, page, zaloIcon } from '../layout.mjs';
import { banner, crumbs, ctaBand, zaloButtons } from '../parts.mjs';
import { img, paragraphs, fmtDate, webText } from '../util.mjs';

const contactBlock = (tag = 'h2') => `
  <div class="branches">
    ${BRANCHES.map((b) => `
    <article class="branch">
      <${tag} class="h3">${esc(b.name)}</${tag}>
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

// ---------- /ve-moana ----------
export function renderAbout(buildId) {
  const body = `${banner('Về Moana', `Spa chăm sóc vấn đề da kết hợp thư giãn tại Hà Nội, từ ${SITE.founded}.`)}
<section class="wrap detail about-intro">
  <div class="detail-img">${img('tu-van', 'Chuyên viên Moana trong buổi chăm sóc da', { eager: true, sizes: '(min-width: 900px) 50vw, 100vw' })}</div>
  <div class="detail-text">
    <p class="label">Câu chuyện của Moana</p>
    <h2 class="detail-title">Chăm sóc bằng sự thấu hiểu từng làn da</h2>
    <p>Moana Beauty mở cửa từ năm ${SITE.founded}, là spa chú trọng chăm sóc các vấn đề da mặt bằng dược mỹ phẩm châu Âu và Mỹ, kết hợp thiết bị công nghệ cao.</p>
    <p>Với Moana, mỗi buổi chăm sóc vừa là thời gian dành cho làn da, vừa là một khoảng nghỉ cho chính bạn — trong không gian thanh lịch, yên tĩnh và sạch sẽ.</p>
    <p>Hiện Moana có hai cơ sở tại Cầu Giấy và Long Biên, Hà Nội.</p>
  </div>
</section>

<section class="journey">
  <div class="wrap section">
    <h2 class="h2 center">Điều Moana theo đuổi</h2>
    <ol class="steps">
      <li><span class="step-no">01</span><span class="step-t">Thấu hiểu làn da</span><span>Bắt đầu từ tình trạng và nhu cầu cụ thể của da bạn.</span></li>
      <li><span class="step-no">02</span><span class="step-t">Cá nhân hoá</span><span>Lựa chọn và điều chỉnh cách chăm sóc phù hợp từng người.</span></li>
      <li><span class="step-no">03</span><span class="step-t">Dễ hiểu</span><span>Giải thích rõ từng bước bằng ngôn ngữ gần gũi.</span></li>
      <li><span class="step-no">04</span><span class="step-t">Chu đáo</span><span>Tư vấn, theo dõi và quan tâm cả trải nghiệm của bạn.</span></li>
    </ol>
  </div>
</section>

<section class="space">
  ${img('khong-gian', 'Giường chăm sóc trải khăn tại Moana', { cls: 'space-img' })}
  <div class="hero-shade"></div>
  <div class="space-text">
    <p class="eyebrow">Không gian Moana</p>
    <h2>Yên tĩnh, sạch sẽ, chu đáo trong từng chi tiết</h2>
    <p>Mỗi chi tiết được Moana chuẩn bị để bạn thật sự được nghỉ ngơi.</p>
  </div>
</section>

<section class="wrap section center">
  <h2 class="h2">Dược mỹ phẩm tại Moana</h2>
  <p class="lead">Moana sử dụng dược mỹ phẩm từ châu Âu và Mỹ, lựa chọn theo tình trạng da trong từng buổi chăm sóc.</p>
  <ul class="brands" aria-label="Các hãng dược mỹ phẩm Moana đang dùng">${BRANDS.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
  <div class="btn-row center mt">
    <a class="btn btn-outline" href="/lieu-trinh">Khám phá liệu trình</a>
    <a class="btn btn-outline" href="/san-pham">Sản phẩm Biologique Recherche</a>
  </div>
</section>

<section class="wrap section pt-0">
  <h2 class="h2 center">Hai cơ sở của Moana</h2>
  ${contactBlock('h3')}
</section>
${ctaBand('Đặt lịch chăm sóc cùng Moana', 'Moana mở cửa 9:00 – 18:00 tất cả các ngày, trừ ngày lễ Tết.')}`;
  return page({
    path: '/ve-moana', title: 'Về Moana', body, buildId, ld: true,
    description: `Moana Beauty — spa chăm sóc vấn đề da kết hợp thư giãn tại Hà Nội từ ${SITE.founded}, dùng dược mỹ phẩm châu Âu và Mỹ. Hai cơ sở tại Cầu Giấy và Long Biên.`,
  });
}

// ---------- /tin-tuc + /tin-tuc/<slug> ----------
const promoDates = (p) => {
  if (p.start_date && p.end_date) return `Từ ${fmtDate(p.start_date)} đến ${fmtDate(p.end_date)}`;
  if (p.end_date) return `Áp dụng đến ${fmtDate(p.end_date)}`;
  if (p.start_date) return `Áp dụng từ ${fmtDate(p.start_date)}`;
  return '';
};

export function newsPages(data, buildId) {
  const promos = data.promotions || [];
  const posts = (data.posts || []).filter((p) => p.slug);
  const empty = !promos.length && !posts.length;

  const body = `${banner('Ưu đãi & Tin tức', 'Chương trình ưu đãi theo tháng, các dịp đặc biệt trong năm và tin tức từ Moana.')}
${promos.length ? `
<section class="wrap section pt-0" id="uu-dai">
  <h2 class="h2 center">Ưu đãi đang áp dụng</h2>
  <div class="grid-promos">
    ${promos.map((p) => `
    <article class="promo">
      <p class="label">Ưu đãi</p>
      <h3 class="card-title">${esc(webText(p.name))}</h3>
      ${promoDates(p) ? `<p class="muted small">${esc(promoDates(p))}</p>` : ''}
      ${p.description ? paragraphs(webText(p.description)) : ''}
      ${p.terms ? `<details class="terms"><summary>Điều kiện áp dụng</summary>${paragraphs(webText(p.terms))}</details>` : ''}
      <div class="btn-row">${zaloButtons('btn btn-outline btn-sm')}</div>
    </article>`).join('')}
  </div>
</section>` : ''}
${posts.length ? `
<section class="news">
  <div class="wrap section">
    <h2 class="h2 center">Tin tức</h2>
    <div class="grid-news">
      ${posts.map((n) => `
      <a class="news-card" href="/tin-tuc/${esc(n.slug)}">
        ${n.cover_url ? `<span class="news-img"><img src="${esc(n.cover_url)}" alt="" loading="lazy"></span>` : ''}
        <span class="card-body">
          <span class="label">${n.kind === 'promotion' ? 'Ưu đãi' : 'Tin tức'}${n.published_at ? ` · ${fmtDate(n.published_at)}` : ''}</span>
          <span class="card-title">${esc(n.title)}</span>
          ${n.summary ? `<span class="news-text">${esc(n.summary)}</span>` : ''}
        </span>
      </a>`).join('')}
    </div>
  </div>
</section>` : ''}
${empty ? `
<section class="wrap section pt-0">
  <div class="news-empty">
    <p>Moana cập nhật ưu đãi theo tháng và các dịp đặc biệt trong năm. Nhắn Zalo để nhận thông tin mới nhất từ cơ sở gần bạn.</p>
    <div class="btn-row center">
      ${zaloButtons()}
    </div>
  </div>
</section>` : ctaBand()}`;

  const out = [{
    path: '/tin-tuc', html: page({
      path: '/tin-tuc', title: 'Ưu đãi & Tin tức', body, buildId,
      description: 'Ưu đãi theo tháng, các dịp đặc biệt và tin tức từ Moana Beauty — spa chăm sóc da tại Cầu Giấy và Long Biên, Hà Nội.',
    }),
  }];

  for (const n of posts) {
    const others = posts.filter((x) => x !== n).slice(0, 3);
    const pbody = `${crumbs([{ href: '/tin-tuc', label: 'Ưu đãi & Tin tức' }, { label: n.title }])}
<article class="wrap article">
  <p class="label">${n.kind === 'promotion' ? 'Ưu đãi' : 'Tin tức'}${n.published_at ? ` · ${fmtDate(n.published_at)}` : ''}</p>
  <h1 class="detail-title">${esc(n.title)}</h1>
  ${n.summary ? `<p class="lead">${esc(n.summary)}</p>` : ''}
  ${n.cover_url ? `<img class="article-cover" src="${esc(n.cover_url)}" alt="" fetchpriority="high">` : ''}
  <div class="prose">${paragraphs(webText(n.body))}</div>
  <div class="btn-row mt">
    <a class="btn btn-solid" href="${SITE.bookingUrl}">Đặt lịch</a>
    ${zaloButtons()}
  </div>
</article>
${others.length ? `
<section class="wrap section pt-0">
  <h2 class="h2 center">Bài khác</h2>
  <div class="grid-news">${others.map((x) => `
    <a class="news-card" href="/tin-tuc/${esc(x.slug)}"><span class="card-body"><span class="card-title">${esc(x.title)}</span>${x.summary ? `<span class="news-text">${esc(x.summary)}</span>` : ''}</span></a>`).join('')}
  </div>
</section>` : ''}`;
    out.push({
      path: `/tin-tuc/${n.slug}`, html: page({
        path: `/tin-tuc/${n.slug}`, title: n.title, body: pbody, buildId,
        description: n.summary || `${n.title} — Moana Beauty`,
      }),
    });
  }
  return out;
}

// ---------- /chinh-sach-bao-mat ----------
export function renderPrivacy(buildId) {
  const updated = '18/11/2026';
  const body = `${banner('Chính sách bảo mật', `Cập nhật ngày ${updated}`)}
<article class="wrap article prose policy">
  <p>Moana Beauty (“Moana”) tôn trọng quyền riêng tư của bạn. Chính sách này giải thích Moana thu thập những thông tin nào khi bạn dùng website moanabeauty.vn và các kênh liên hệ của Moana, dùng thông tin đó để làm gì và bạn có những quyền gì.</p>

  <h2>1. Thông tin Moana thu thập</h2>
  <ul>
    <li><strong>Khi bạn xem website:</strong> website dùng Google Analytics để ghi nhận số liệu truy cập chung (trang đã xem, thiết bị, trình duyệt, khu vực gần đúng). Các số liệu này dùng để thống kê, không dùng để xác định danh tính từng người.</li>
    <li><strong>Khi bạn đặt lịch trực tuyến:</strong> thông tin bạn điền trong trang đặt lịch, như họ tên, số điện thoại, cơ sở, liệu trình và thời gian mong muốn, cùng ghi chú nếu có.</li>
    <li><strong>Khi bạn liên hệ qua Zalo, điện thoại, Facebook hoặc email:</strong> thông tin bạn chủ động cung cấp trong cuộc trao đổi.</li>
    <li><strong>Khi bạn sử dụng dịch vụ tại spa:</strong> thông tin cần cho việc chăm sóc, như tình trạng da bạn chia sẻ với chuyên viên và lịch sử liệu trình.</li>
  </ul>
  <p>Website không có giỏ hàng hay thanh toán trực tuyến, nên Moana không thu thập thông tin thẻ hoặc tài khoản ngân hàng qua website.</p>

  <h2>2. Mục đích sử dụng</h2>
  <ul>
    <li>Xác nhận, sắp xếp và nhắc lịch hẹn.</li>
    <li>Tư vấn liệu trình, combo và sản phẩm theo yêu cầu của bạn.</li>
    <li>Theo dõi tình trạng da để điều chỉnh cách chăm sóc ở các buổi sau.</li>
    <li>Gửi thông tin ưu đãi khi bạn đồng ý nhận.</li>
    <li>Cải thiện nội dung và trải nghiệm trên website.</li>
  </ul>

  <h2>3. Chia sẻ thông tin</h2>
  <p>Moana không bán thông tin cá nhân của bạn. Thông tin chỉ được chia sẻ với các nhà cung cấp dịch vụ kỹ thuật cần thiết để vận hành website, hệ thống đặt lịch và liên lạc (ví dụ: dịch vụ lưu trữ website, lưu trữ dữ liệu, Google Analytics, Zalo), hoặc khi cơ quan nhà nước có thẩm quyền yêu cầu theo quy định pháp luật.</p>

  <h2>4. Lưu trữ và bảo vệ</h2>
  <p>Thông tin được lưu trong thời gian cần thiết cho các mục đích nêu trên hoặc theo yêu cầu của pháp luật. Chỉ nhân sự có nhiệm vụ liên quan mới được truy cập, và Moana áp dụng các biện pháp kỹ thuật hợp lý để bảo vệ thông tin khỏi truy cập trái phép.</p>

  <h2>5. Quyền của bạn</h2>
  <p>Bạn có thể yêu cầu Moana cho biết, chỉnh sửa hoặc xoá thông tin cá nhân của mình, rút lại sự đồng ý nhận tin ưu đãi, theo quy định của pháp luật Việt Nam về bảo vệ dữ liệu cá nhân. Gửi yêu cầu qua email <a href="mailto:${SITE.email}">${SITE.email}</a> hoặc liên hệ hotline của một trong hai cơ sở.</p>

  <h2>6. Cookie</h2>
  <p>Google Analytics dùng cookie để ghi nhận lượt truy cập. Bạn có thể chặn hoặc xoá cookie trong cài đặt trình duyệt; website vẫn hoạt động bình thường.</p>

  <h2>7. Thay đổi chính sách</h2>
  <p>Moana có thể cập nhật chính sách này khi cần. Phiên bản mới sẽ được đăng tại trang này kèm ngày cập nhật.</p>

  <h2>8. Liên hệ</h2>
  <p>Moana Beauty — ${BRANCHES.map((b) => `${esc(b.name)}: ${esc(b.address)}, hotline <a href="tel:${b.phone}">${esc(b.phoneLabel)}</a>`).join('; ')}. Email: <a href="mailto:${SITE.email}">${SITE.email}</a>.</p>
</article>`;
  return page({ path: '/chinh-sach-bao-mat', title: 'Chính sách bảo mật', body, buildId, description: 'Chính sách bảo mật thông tin cá nhân của Moana Beauty khi bạn dùng website, đặt lịch và liên hệ.' });
}

// ---------- /lien-he ----------
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
