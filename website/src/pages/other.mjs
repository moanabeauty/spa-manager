// Trang Về Moana, Beauty Vlog (+ bài viết), Chính sách bảo mật, Liên hệ, 404.
import { SITE, BRANCHES, BRANDS } from '../site.mjs';
import { esc, page, zaloIcon } from '../layout.mjs';
import { banner, crumbs, ctaBand, zaloButtons } from '../parts.mjs';
import { img, fmtDate, webText, postBody, videoBlock, videoEmbed, svcSlug, pkgSlug } from '../util.mjs';

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
// Định vị (chủ spa chốt 19/11/2026): spa chuyên chăm sóc da mặt ở Hà Nội — lấy nhân mụn không đau,
// kiểm soát mụn hạn chế tái phát, đầy đủ liệu trình Biologique Recherche (Pháp).
export function renderAbout(data, buildId) {
  const services = data.services || [];
  const packages = data.packages || [];
  const tweezer = services.find((s) => (s.name_en || '').toUpperCase() === 'ACNE TWEEZER');
  const acneLink = tweezer ? `/lieu-trinh/${svcSlug(tweezer)}` : '/lieu-trinh#cham-soc-da-co-ban';
  const acneGroup = packages.find((p) => /^Mụn/i.test(p.category || ''))?.category;
  const acnePkgLink = acneGroup ? `/promotion#${pkgSlug({ name: acneGroup })}` : '/promotion';
  const brCount = services.filter((s) => (s.category || '').startsWith('Biologique Recherche')).length;

  const body = `${banner('Về Moana', `Spa chuyên chăm sóc da mặt tại Hà Nội, từ ${SITE.founded}.`)}
<section class="wrap detail about-intro">
  <div class="detail-img">${img('tu-van', 'Chuyên viên Moana trong buổi chăm sóc da mặt', { eager: true, sizes: '(min-width: 900px) 50vw, 100vw' })}</div>
  <div class="detail-text">
    <p class="label">Câu chuyện của Moana</p>
    <h2 class="detail-title">Chăm sóc bằng sự thấu hiểu từng làn da</h2>
    <p>Moana Beauty là spa chuyên chăm sóc da mặt tại Hà Nội, mở cửa từ năm ${SITE.founded}. Moana tập trung vào ba điều: <strong>lấy nhân mụn không đau</strong>, <strong>kiểm soát tình trạng mụn để hạn chế tái phát</strong> và mang đến <strong>đầy đủ các liệu trình Biologique Recherche (Pháp)</strong>.</p>
    <p>Mỗi buổi chăm sóc bắt đầu từ việc lắng nghe và xem kỹ tình trạng da của bạn, sau đó Moana mới chọn liệu trình và sản phẩm phù hợp. Với Moana, đó vừa là thời gian dành cho làn da, vừa là một khoảng nghỉ cho chính bạn — trong không gian yên tĩnh, sạch sẽ.</p>
    <p>Hiện Moana có hai cơ sở tại Cầu Giấy và Long Biên, Hà Nội.</p>
  </div>
</section>

<section class="wrap section pt-0">
  <h2 class="h2 center">Moana chuyên về</h2>
  <div class="entries about-focus">
    <article class="entry">
      <div class="entry-img">${img('nhom-co-ban', 'Chăm sóc da mặt cho khách tại Moana', { sizes: '(min-width: 900px) 33vw, 100vw' })}</div>
      <h3 class="h3">Lấy nhân mụn không đau</h3>
      <p>Moana dùng kỹ thuật Acne Tweezer kết hợp nhiều phương pháp lấy nhân mụn, giúp lấy nhân sạch, nhẹ nhàng và hạn chế tổn thương cho da.</p>
      <a class="btn btn-outline" href="${acneLink}">Xem liệu trình Acne Tweezer</a>
    </article>
    <article class="entry">
      <div class="entry-img">${img('tu-van-da', 'Chuyên viên Moana tư vấn lộ trình kiểm soát mụn cho khách', { sizes: '(min-width: 900px) 33vw, 100vw' })}</div>
      <h3 class="h3">Kiểm soát mụn, hạn chế tái phát</h3>
      <p>Không dừng ở một buổi lấy nhân mụn, Moana xây dựng lộ trình kiểm soát mụn theo từng làn da, theo dõi da qua từng buổi và hướng dẫn bạn chăm sóc tại nhà.</p>
      <a class="btn btn-outline" href="${acnePkgLink}">Gói kiểm soát mụn</a>
    </article>
    <article class="entry">
      <div class="entry-img">${img('nhom-biologique', 'Liệu trình Biologique Recherche tại Moana', { sizes: '(min-width: 900px) 33vw, 100vw' })}</div>
      <h3 class="h3">Đầy đủ liệu trình Biologique Recherche</h3>
      <p>Moana mang đến đầy đủ các liệu trình của Biologique Recherche — thương hiệu chăm sóc da đến từ Pháp${brCount ? `, với ${brCount} liệu trình đang có tại spa` : ''}. Sản phẩm được chọn theo tình trạng da của bạn ở từng buổi.</p>
      <a class="btn btn-outline" href="/lieu-trinh#biologique-recherche">Liệu trình Biologique Recherche</a>
    </article>
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
  <p class="lead">Bên cạnh Biologique Recherche, Moana sử dụng dược mỹ phẩm từ châu Âu và Mỹ, lựa chọn theo tình trạng da trong từng buổi chăm sóc.</p>
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
${ctaBand('Đặt lịch chăm sóc da cùng Moana', 'Moana mở cửa thứ Hai – thứ Sáu 9:00 – 18:30, thứ Bảy – Chủ nhật 9:00 – 19:00, trừ ngày lễ Tết.')}`;
  return page({
    path: '/ve-moana', title: 'Về Moana – Spa chăm sóc da mặt Hà Nội', body, buildId, ld: true,
    description: `Moana Beauty — spa chuyên chăm sóc da mặt tại Hà Nội từ ${SITE.founded}: lấy nhân mụn không đau; kiểm soát mụn nội tiết, mụn dậy thì, mụn do thay đổi thời tiết; đầy đủ liệu trình Biologique Recherche (Pháp).`,
  });
}

// ---------- /beauty-vlog + /beauty-vlog/<slug> ----------
// Bài viết soạn trong app (Cài đặt › Bài viết web khách), có thể gắn video TikTok / YouTube.
const KIND = { skincare: 'Góc chăm da', new_treatment: 'Liệu trình mới' };
const kindLabel = (n) => KIND[n.kind] || 'Beauty Vlog';
const VLOG_INTRO = 'Moana chia sẻ kinh nghiệm chăm sóc da, thói quen làm đẹp hằng ngày và những điều nên biết trước khi bắt đầu một liệu trình.';

const vlogThumb = (n) => {
  if (n.cover_url) return `<span class="news-img"><img src="${esc(n.cover_url)}" alt="" loading="lazy" decoding="async"></span>`;
  const v = videoEmbed(n.video_url);
  if (v?.id) return `<span class="news-img"><img src="https://i.ytimg.com/vi/${v.id}/hqdefault.jpg" alt="" loading="lazy" decoding="async"></span>`;
  return '';
};
const vlogCard = (n) => `
      <a class="news-card" href="/beauty-vlog/${esc(n.slug)}">
        ${vlogThumb(n)}
        <span class="card-body">
          <span class="label">${esc(kindLabel(n))}${n.video_url ? ' · Video' : ''}${n.published_at ? ` · ${fmtDate(n.published_at)}` : ''}</span>
          <span class="card-title">${esc(n.title)}</span>
          ${n.summary ? `<span class="news-text">${esc(n.summary)}</span>` : ''}
        </span>
      </a>`;

export function vlogPages(data, buildId) {
  const posts = (data.posts || []).filter((p) => p.slug);
  const body = `${banner('Beauty Vlog', VLOG_INTRO)}
${posts.length ? `
<section class="wrap section pt-0">
  <div class="grid-news grid-vlog">${posts.map(vlogCard).join('')}
  </div>
</section>
${ctaBand()}` : `
<section class="wrap section pt-0">
  <div class="news-empty">
    <p>Những bài chia sẻ đầu tiên sẽ sớm có mặt tại đây. Trong lúc chờ, bạn có thể theo dõi Moana trên TikTok và Instagram.</p>
    <div class="btn-row center">
      <a class="btn btn-outline" href="${SITE.tiktok}" rel="noopener">TikTok Moana</a>
      <a class="btn btn-outline" href="${SITE.instagram}" rel="noopener">Instagram Moana</a>
    </div>
  </div>
</section>`}`;

  const out = [{
    path: '/beauty-vlog', html: page({
      path: '/beauty-vlog', title: 'Beauty Vlog', body, buildId,
      description: 'Beauty Vlog của Moana Beauty: chia sẻ kinh nghiệm chăm sóc da, làm đẹp và những điều nên biết trước khi bắt đầu liệu trình.',
    }),
  }];

  for (const n of posts) {
    const others = posts.filter((x) => x !== n).slice(0, 3);
    const pbody = `${crumbs([{ href: '/beauty-vlog', label: 'Beauty Vlog' }, { label: n.title }])}
<article class="wrap article">
  <p class="label">${esc(kindLabel(n))}${n.published_at ? ` · ${fmtDate(n.published_at)}` : ''}</p>
  <h1 class="detail-title">${esc(n.title)}</h1>
  ${n.summary ? `<p class="lead">${esc(n.summary)}</p>` : ''}
  ${n.video_url ? videoBlock(n.video_url, n.title) : (n.cover_url ? `<img class="article-cover" src="${esc(n.cover_url)}" alt="" fetchpriority="high">` : '')}
  <div class="prose post-body">${postBody(webText(n.body))}</div>
  <div class="btn-row mt">
    <a class="btn btn-solid" href="${SITE.bookingUrl}">Đặt lịch</a>
    ${zaloButtons()}
  </div>
</article>
${others.length ? `
<section class="wrap section pt-0">
  <h2 class="h2 center">Bài khác</h2>
  <div class="grid-news">${others.map(vlogCard).join('')}
  </div>
</section>` : ''}`;
    out.push({
      path: `/beauty-vlog/${n.slug}`, html: page({
        path: `/beauty-vlog/${n.slug}`, title: n.title, body: pbody, buildId,
        description: n.summary || `${n.title} — Beauty Vlog của Moana Beauty`,
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
  const body = `${banner('Liên hệ', 'Moana mở cửa thứ Hai – thứ Sáu 9:00 – 18:30, thứ Bảy – Chủ nhật 9:00 – 19:00, trừ ngày lễ Tết. Bạn có thể đặt lịch trực tuyến, gọi điện hoặc nhắn Zalo cho cơ sở gần nhất.')}
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
