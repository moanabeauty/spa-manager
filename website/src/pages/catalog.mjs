// Trang Liệu trình, Promotion (ưu đãi theo tháng + các gói/combo), Bảng giá (+ trang chi tiết).
// Giá liệu trình & gói CHỈ hiện ở trang Bảng giá (quy ước đã chốt). Trên web, "combo" trong app được gọi là Promotion.
import { SITE, GROUPS, COMBO_IMAGES, SERVICE_IMAGES } from '../site.mjs';
import { esc, page } from '../layout.mjs';
import { banner, crumbs, ctaBand, zaloButtons } from '../parts.mjs';
import { slugify, img, money, webText, svcName, titleEn, svcSlug, pkgSlug, paragraphs, fmtDate } from '../util.mjs';

// ---------- Chuẩn bị dữ liệu ----------
export function prepare(data) {
  const services = (data.services || []).map((s) => ({ ...s, slug: svcSlug(s), vn: svcName(s), en: titleEn(s.name_en) }));
  // Tên tiếng Việt trùng nhau (vd. 2 liệu trình "Chăm sóc da dầu cơ bản") -> thêm tên tiếng Anh vào đường dẫn
  for (const s of services) {
    if (services.filter((x) => x.slug === s.slug).length > 1) s.dup = true;
  }
  for (const s of services) if (s.dup) s.slug = slugify(`${s.vn} ${s.name_en}`);
  const groups = GROUPS.map((g) => ({
    ...g,
    items: services.filter((s) => (s.category || '').startsWith(g.match)),
  })).filter((g) => g.items.length);
  for (const g of groups) for (const s of g.items) s.group = g;
  // Liệu trình chưa thuộc nhóm nào trong GROUPS vẫn được hiện, gom vào nhóm "Liệu trình khác".
  const loose = services.filter((s) => !s.group);
  if (loose.length) {
    const g = { slug: 'khac', title: 'Liệu trình khác', tags: '', intro: '', image: 'noi-bat', items: loose };
    for (const s of loose) s.group = g;
    groups.push(g);
  }

  const packages = (data.packages || []).map((p) => ({
    ...p, slug: pkgSlug(p), desc: webText(p.description),
    items: (p.items || []).map((i) => ({ ...i, label: webText(i.label) })),
  }));
  // Liên kết combo <-> liệu trình: tên tiếng Anh của liệu trình xuất hiện trong nội dung combo,
  // hoặc combo dùng chung cho cả nhóm ("... thuộc nhóm Essential Treatment").
  for (const p of packages) {
    const hay = [p.description, ...p.items.map((i) => i.label)].join(' | ').toLowerCase();
    p.services = services.filter((s) => {
      const en = (s.name_en || '').toLowerCase();
      if (en && hay.includes(en)) return true;
      return s.group?.match && hay.includes(`nhóm ${s.group.match.toLowerCase()}`);
    });
    p.image = (COMBO_IMAGES.find((c) => (p.category || '').startsWith(c.match)) || {}).image
      || p.services[0]?.group?.image || 'noi-bat';
  }
  for (const s of services) s.packages = packages.filter((p) => p.services.includes(s));

  const pkgGroups = [];
  for (const p of packages) {
    const key = p.category || 'Gói khác';
    let g = pkgGroups.find((x) => x.title === key);
    if (!g) pkgGroups.push((g = { title: key, slug: pkgSlug({ name: key }), items: [] }));
    g.items.push(p);
  }
  return { services, groups, packages, pkgGroups, promotions: data.promotions || [] };
}

const duration = (s) => (s.duration_minutes ? `${s.duration_minutes} phút` : '');
const validity = (p) => {
  const d = p.validity_days;
  if (!d) return '';
  if (d % 365 === 0) return `Hạn dùng ${d / 365 === 1 ? '1 năm' : `${d / 365} năm`}`;
  if (d % 30 === 0) return `Hạn dùng ${d / 30} tháng`;
  return `Hạn dùng ${d} ngày`;
};
const itemLine = (i) => `${i.quantity ? `<span class="qty">${i.quantity}×</span> ` : ''}${esc(i.label)}`;
const chips = (list, prefix = '') => `
<nav class="chips wrap" aria-label="Chọn nhóm">
  ${list.map((g) => `<a href="${prefix}#${g.slug}">${esc(g.title)}</a>`).join('\n  ')}
</nav>`;

const svcRow = (s) => `
      <a class="row-link" href="/lieu-trinh/${s.slug}">
        <span class="row-main">
          <span class="row-title">${esc(s.en)}</span>
          <span class="row-sub">${esc(s.vn)}</span>
        </span>
        <span class="row-meta">${esc(duration(s))}</span>
        <span class="row-arrow" aria-hidden="true">→</span>
      </a>`;

const comboCard = (p) => `
    <a class="combo" href="/promotion/${p.slug}">
      <span class="label">${esc(webText(p.category || 'Promotion'))}</span>
      <span class="card-title">${esc(p.name)}</span>
      ${p.desc ? `<span class="combo-desc">${esc(p.desc)}</span>` : ''}
      <ul class="combo-items">${p.items.map((i) => `<li>${itemLine(i)}</li>`).join('')}</ul>
      ${validity(p) ? `<span class="row-meta">${esc(validity(p))}</span>` : ''}
      <span class="link">Xem chi tiết</span>
    </a>`;

// ---------- /lieu-trinh ----------
function renderServicesIndex(ctx, buildId) {
  const body = `${banner('Liệu trình', 'Mỗi liệu trình tại Moana bắt đầu từ tư vấn theo tình trạng da. Chọn nhóm theo nhu cầu, hoặc nhắn Moana để được gợi ý lựa chọn phù hợp.')}
${chips(ctx.groups)}
${ctx.groups.map((g, i) => `
<section class="wrap group${i ? '' : ' group-first'}" id="${g.slug}">
  <div class="group-head">
    <div class="group-img">${img(g.image, g.title, { sizes: '(min-width: 900px) 40vw, 100vw' })}</div>
    <div class="group-text">
      ${g.tags ? `<p class="label">${esc(g.tags)}</p>` : ''}
      <h2 class="h2">${esc(g.title)}</h2>
      ${g.intro ? `<p>${esc(g.intro)}</p>` : ''}
      <p class="muted">${g.items.length} liệu trình</p>
    </div>
  </div>
  <div class="rows">${g.items.map(svcRow).join('')}
  </div>
</section>`).join('')}
<div class="wrap center section-s">
  <div class="btn-row center">
    <a class="btn btn-outline" href="/bang-gia">Xem bảng giá</a>
    <a class="btn btn-outline" href="/promotion">Xem Promotion</a>
  </div>
</div>
${ctaBand()}`;
  return page({
    path: '/lieu-trinh', title: 'Liệu trình', body, buildId,
    description: 'Liệu trình chăm sóc da mặt tại Moana Beauty Hà Nội: lấy nhân mụn không đau; kiểm soát mụn nội tiết, mụn dậy thì, mụn do thay đổi thời tiết; Biologique Recherche (Pháp), peel, phi kim…',
  });
}

// ---------- /lieu-trinh/<slug> ----------
function renderService(s, ctx, buildId) {
  const g = s.group;
  const others = g.items.filter((x) => x !== s);
  const pics = SERVICE_IMAGES[(s.name_en || '').trim().toUpperCase()] || [g.image];
  const body = `${crumbs([{ href: '/lieu-trinh', label: 'Liệu trình' }, { href: `/lieu-trinh#${g.slug}`, label: g.title }, { label: s.en }])}
<section class="wrap detail">
  <div class="detail-img">${img(pics[0], `${s.en} — ${s.vn}`, { eager: true, sizes: '(min-width: 900px) 50vw, 100vw' })}</div>
  <div class="detail-text">
    <p class="label">${esc(g.title)}</p>
    <h1 class="detail-title">${esc(s.en)}</h1>
    <p class="detail-sub">${esc(s.vn)}</p>
    ${duration(s) ? `<p class="muted">Thời lượng khoảng ${esc(duration(s))}</p>` : ''}
    ${s.description ? `<div class="prose">${webText(s.description).split(/\n+/).map((p) => `<p>${esc(p)}</p>`).join('')}</div>` : (g.intro ? `<p>${esc(g.intro)}</p>` : '')}
    <p>Trước buổi chăm sóc, chuyên viên Moana trao đổi về tình trạng da và nhu cầu của bạn để điều chỉnh các bước cho phù hợp.</p>
    <div class="btn-row">
      <a class="btn btn-solid" href="${SITE.bookingUrl}">Đặt lịch</a>
      ${zaloButtons()}
    </div>
    <p class="mt-s"><a class="link" href="/bang-gia#${s.slug}">Xem giá liệu trình tại Bảng giá</a></p>
  </div>
</section>
${pics.length > 1 ? `
<section class="wrap pt-0 gallery">${pics.slice(1).map((p) => `
  <div class="gallery-img">${img(p, `${s.en} tại Moana`, { sizes: '(min-width: 900px) 33vw, 50vw' })}</div>`).join('')}
</section>` : ''}

<section class="journey">
  <div class="wrap section">
    <h2 class="h2 center">Buổi chăm sóc tại Moana</h2>
    <ol class="steps">
      <li><span class="step-no">01</span><span class="step-t">Tư vấn</span><span>Xác định điều làn da đang cần ưu tiên.</span></li>
      <li><span class="step-no">02</span><span class="step-t">Lựa chọn</span><span>Chọn các bước và sản phẩm phù hợp, giải thích rõ từng bước.</span></li>
      <li><span class="step-no">03</span><span class="step-t">Chăm sóc</span><span>Thực hiện trong không gian yên tĩnh, sạch sẽ.</span></li>
      <li><span class="step-no">04</span><span class="step-t">Theo dõi</span><span>Theo sát làn da sau buổi và điều chỉnh khi cần.</span></li>
    </ol>
  </div>
</section>

${s.packages.length ? `
<section class="wrap section">
  <h2 class="h2 center">Promotion có ${esc(s.en)}</h2>
  <div class="grid-combos">${s.packages.map(comboCard).join('')}
  </div>
</section>` : ''}

${others.length ? `
<section class="wrap section${s.packages.length ? ' pt-0' : ''}">
  <h2 class="h2 center">Cùng nhóm ${esc(g.title)}</h2>
  <div class="rows">${others.map(svcRow).join('')}
  </div>
</section>` : ''}
${ctaBand()}`;
  return page({
    path: `/lieu-trinh/${s.slug}`, title: `${s.en} — ${s.vn}`, body, buildId,
    description: `${s.en} (${s.vn}) — liệu trình nhóm ${g.title} tại Moana Beauty, Hà Nội. Tư vấn theo tình trạng da trước mỗi buổi chăm sóc.`,
  });
}

// ---------- /promotion ----------
const promoDates = (p) => {
  if (p.start_date && p.end_date) return `Từ ${fmtDate(p.start_date)} đến ${fmtDate(p.end_date)}`;
  if (p.end_date) return `Áp dụng đến ${fmtDate(p.end_date)}`;
  if (p.start_date) return `Áp dụng từ ${fmtDate(p.start_date)}`;
  return '';
};

function renderCombosIndex(ctx, buildId) {
  const promos = ctx.promotions;
  const body = `${banner('Promotion', 'Ưu đãi theo tháng và các gói chăm sóc nhiều buổi của Moana. Moana tư vấn để bạn chọn lựa chọn phù hợp với làn da và lịch của mình.')}
<nav class="chips wrap" aria-label="Chọn nhóm">
  <a href="#uu-dai">Ưu đãi tháng này</a>
  ${ctx.pkgGroups.map((g) => `<a href="#${g.slug}">${esc(webText(g.title))}</a>`).join('\n  ')}
</nav>

<section class="wrap group group-first" id="uu-dai">
  <h2 class="h2">Ưu đãi tháng này</h2>
  ${promos.length ? `
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
  </div>` : `
  <div class="promo promo-empty">
    <p>Moana cập nhật ưu đãi theo tháng và các dịp đặc biệt trong năm. Nhắn Zalo để nhận thông tin ưu đãi mới nhất từ cơ sở gần bạn.</p>
    <div class="btn-row">${zaloButtons('btn btn-outline btn-sm')}</div>
  </div>`}
</section>

${ctx.pkgGroups.map((g) => `
<section class="wrap group" id="${g.slug}">
  <h2 class="h2">${esc(webText(g.title))}</h2>
  <div class="grid-combos">${g.items.map(comboCard).join('')}
  </div>
</section>`).join('')}
<div class="wrap center section-s">
  <a class="btn btn-outline" href="/bang-gia#promotion">Xem giá các gói</a>
</div>
${ctaBand('Chưa biết chọn gói nào?', 'Nhắn Moana để được tư vấn theo tình trạng da và tần suất bạn có thể đến spa.')}`;
  return page({
    path: '/promotion', title: 'Promotion — Ưu đãi & gói chăm sóc', body, buildId,
    description: 'Promotion tại Moana Beauty: ưu đãi theo tháng và các gói chăm sóc da nhiều buổi — chăm sóc da cơ bản, mụn – lỗ chân lông, sáng da, Biologique Recherche, tóc – da đầu, triệt lông.',
  });
}

// ---------- /promotion/<slug> ----------
function renderCombo(p, ctx, buildId) {
  const same = ctx.packages.filter((x) => x !== p && x.category === p.category);
  const body = `${crumbs([{ href: '/promotion', label: 'Promotion' }, { label: p.name }])}
<section class="wrap detail">
  <div class="detail-img">${img(p.image, p.name, { eager: true, sizes: '(min-width: 900px) 50vw, 100vw' })}</div>
  <div class="detail-text">
    <p class="label">${esc(webText(p.category || 'Promotion'))}</p>
    <h1 class="detail-title">${esc(p.name)}</h1>
    ${p.desc ? `<p class="detail-sub">${esc(p.desc)}</p>` : ''}
    <h2 class="h3">Gói gồm</h2>
    <ul class="combo-items big">${p.items.map((i) => `<li>${itemLine(i)}</li>`).join('')}</ul>
    ${validity(p) ? `<p class="muted">${esc(validity(p))}</p>` : ''}
    <div class="btn-row mt-s">
      <a class="btn btn-solid" href="${SITE.bookingUrl}">Đặt lịch</a>
      ${zaloButtons()}
    </div>
    <p class="mt-s"><a class="link" href="/bang-gia#${p.slug}">Xem giá tại Bảng giá</a></p>
  </div>
</section>

${p.services.length ? `
<section class="wrap section">
  <h2 class="h2 center">Liệu trình trong gói</h2>
  <div class="rows">${p.services.map(svcRow).join('')}
  </div>
</section>` : ''}

${same.length ? `
<section class="wrap section${p.services.length ? ' pt-0' : ''}">
  <h2 class="h2 center">Promotion cùng nhóm</h2>
  <div class="grid-combos">${same.slice(0, 6).map(comboCard).join('')}
  </div>
</section>` : ''}
${ctaBand()}`;
  return page({
    path: `/promotion/${p.slug}`, title: `${p.name} — Promotion`, body, buildId,
    description: `${p.name} — Promotion tại Moana Beauty${p.desc ? `: ${p.desc}` : ''}. Gồm: ${p.items.map((i) => `${i.quantity ? `${i.quantity} ` : ''}${i.label}`).join(', ')}.`.slice(0, 300),
  });
}

// ---------- /bang-gia ----------
function renderPrices(ctx, buildId) {
  const body = `${banner('Bảng giá', 'Giá niêm yết các liệu trình và gói Promotion tại Moana Beauty, áp dụng cho cả hai cơ sở.')}
<nav class="chips wrap" aria-label="Chọn bảng giá">
  <a href="#lieu-trinh">Liệu trình</a>
  <a href="#promotion">Promotion</a>
</nav>

<section class="wrap group group-first" id="lieu-trinh">
  <h2 class="h2">Liệu trình</h2>
  <p class="muted note">Giá thành viên dành cho khách hàng thành viên của Moana. Nhắn Zalo để được tư vấn về chương trình thành viên.</p>
  ${ctx.groups.map((g) => `
  <div class="price-group">
    <h3 class="price-h">${esc(g.title)}</h3>
    <div class="price-table" role="table" aria-label="Giá ${esc(g.title)}">
      <div class="price-row price-head" role="row">
        <span role="columnheader">Liệu trình</span>
        <span role="columnheader">Thời lượng</span>
        <span role="columnheader">Giá niêm yết</span>
        <span role="columnheader">Giá thành viên</span>
      </div>
      ${g.items.map((s) => `
      <div class="price-row" role="row" id="${s.slug}">
        <span role="cell" class="price-name"><a href="/lieu-trinh/${s.slug}">${esc(s.en)}</a><small>${esc(s.vn)}</small></span>
        <span role="cell" class="price-dur" data-label="Thời lượng">${esc(duration(s))}</span>
        <span role="cell" class="price-val" data-label="Giá niêm yết">${money(s.price)}</span>
        <span role="cell" class="price-val" data-label="Giá thành viên">${s.member_price ? money(s.member_price) : '—'}</span>
      </div>`).join('')}
    </div>
  </div>`).join('')}
</section>

<section class="wrap group" id="promotion">
  <h2 class="h2">Promotion</h2>
  ${ctx.pkgGroups.map((g) => `
  <div class="price-group">
    <h3 class="price-h">${esc(webText(g.title))}</h3>
    <div class="price-table combo-table" role="table" aria-label="Giá Promotion ${esc(g.title)}">
      <div class="price-row price-head" role="row">
        <span role="columnheader">Gói</span>
        <span role="columnheader">Bao gồm</span>
        <span role="columnheader">Giá</span>
      </div>
      ${g.items.map((p) => `
      <div class="price-row" role="row" id="${p.slug}">
        <span role="cell" class="price-name"><a href="/promotion/${p.slug}">${esc(p.name)}</a>${p.desc ? `<small>${esc(p.desc)}</small>` : ''}</span>
        <span role="cell" class="price-inc">${p.items.map((i) => `<span>${itemLine(i)}</span>`).join('')}${validity(p) ? `<small>${esc(validity(p))}</small>` : ''}</span>
        <span role="cell" class="price-val" data-label="Giá">${money(p.price)}</span>
      </div>`).join('')}
    </div>
  </div>`).join('')}
  <p class="muted note">Giá có thể thay đổi theo từng thời điểm. Vui lòng nhắn Zalo hoặc gọi hotline để Moana xác nhận giá và ưu đãi hiện hành trước khi đặt lịch.</p>
</section>
${ctaBand()}`;
  return page({
    path: '/bang-gia', title: 'Bảng giá', body, buildId,
    description: 'Bảng giá liệu trình và Promotion tại Moana Beauty — spa chăm sóc da tại 67 Lưu Quang Vũ (Cầu Giấy) và 109 Nguyễn Sơn (Long Biên), Hà Nội.',
  });
}

export function catalogPages(data, buildId) {
  const ctx = prepare(data);
  const out = [
    { path: '/lieu-trinh', html: renderServicesIndex(ctx, buildId) },
    ...ctx.services.map((s) => ({ path: `/lieu-trinh/${s.slug}`, html: renderService(s, ctx, buildId) })),
    { path: '/promotion', html: renderCombosIndex(ctx, buildId) },
    ...ctx.packages.map((p) => ({ path: `/promotion/${p.slug}`, html: renderCombo(p, ctx, buildId) })),
    { path: '/bang-gia', html: renderPrices(ctx, buildId) },
  ];
  return { pages: out, ctx };
}
