// Thông tin cố định của Moana Beauty — sửa ở đây là đổi trên toàn website.
export const SITE = {
  name: 'Moana Beauty',
  url: 'https://moanabeauty.vn',
  description:
    'Moana Beauty — spa chăm sóc vấn đề da kết hợp thư giãn tại Hà Nội, cùng dược mỹ phẩm châu Âu và Mỹ. Cơ sở Trung Hoà (Cầu Giấy) và Long Biên.',
  founded: 2019,
  hours: 'Mở cửa 9:00 – 18:00 hằng ngày, trừ ngày lễ Tết',
  email: 'info@moanabeauty.vn',
  bookingUrl: 'https://spa-manager-five.vercel.app/dat-lich',
  gaId: 'G-VSFLDPBPZK',
  instagram: 'https://www.instagram.com/moana.beauty.vn',
  tiktok: 'https://www.tiktok.com/@moanabeautyspa',
};

export const BRANCHES = [
  {
    key: 'trung-hoa',
    name: 'CS Trung Hoà',
    address: '67 Lưu Quang Vũ, Trung Hoà, Cầu Giấy, Hà Nội',
    street: '67 Lưu Quang Vũ',
    district: 'Cầu Giấy',
    phone: '0835288888',
    phoneLabel: '0835 288 888',
    zalo: 'https://zalo.me/0835288888',
    map: 'https://maps.app.goo.gl/ani8W7DJdvisX7Cn9',
    facebook: 'https://www.facebook.com/share/18iqNZ87nc/',
  },
  {
    key: 'long-bien',
    name: 'CS Long Biên',
    address: '109 Nguyễn Sơn, Bồ Đề, Long Biên, Hà Nội',
    street: '109 Nguyễn Sơn',
    district: 'Long Biên',
    phone: '0829989999',
    phoneLabel: '0829 989 999',
    zalo: 'https://zalo.me/0829989999',
    map: 'https://maps.app.goo.gl/3f2uAeTMMZrijDP79',
    facebook: 'https://www.facebook.com/share/1AFEhZ5NkR/',
  },
];

export const NAV_LEFT = [
  { href: '/lieu-trinh', label: 'Liệu trình' },
  { href: '/combo', label: 'Combo' },
  { href: '/bang-gia', label: 'Bảng giá' },
  { href: '/san-pham', label: 'Sản phẩm' },
];
export const NAV_RIGHT = [
  { href: '/ve-moana', label: 'Về Moana' },
  { href: '/tin-tuc', label: 'Ưu đãi' },
  { href: '/lien-he', label: 'Liên hệ' },
];

export const BRANDS = [
  'Biologique Recherche', 'DMK', 'Ericson Laboratoire', 'Comfort Zone', 'Simildiet',
  'Mesoestetic', 'Dermaquest', 'iS Clinical', 'Sesderma', 'Mediderma', 'Vivant',
];

// Nhóm liệu trình trên trang chủ: khớp theo tên nhóm trong app (service_categories).
// Nhóm chỉ hiện khi có ít nhất 1 liệu trình Public.
export const GROUPS = [
  { slug: 'cham-soc-da-co-ban', intro: 'Các liệu trình nền tảng giúp làm sạch, cấp ẩm và làm dịu da — phù hợp để duy trì làn da khoẻ theo định kỳ.', match: 'Essential Treatment', title: 'Chăm sóc da cơ bản', tags: 'Làm sạch sâu / Cấp ẩm / Làm dịu', image: 'co-ban' },
  { slug: 'biologique-recherche', intro: 'Liệu trình cùng sản phẩm Biologique Recherche (Pháp), được Moana lựa chọn theo tình trạng da của bạn ở từng buổi.', match: 'Biologique Recherche', title: 'Biologique Recherche', tags: 'Cấp ẩm / Phục hồi / Nâng cơ', image: 'biologique' },
  { slug: 'peel', intro: 'Peel căng bóng với hai lựa chọn có bong và không bong — Moana tư vấn theo tình trạng da và lịch sinh hoạt của bạn.', match: 'Chemical Peel', title: 'Peel căng bóng', tags: 'Căng bóng / Đều màu da', image: 'peel' },
  { slug: 'phi-kim', intro: 'Các liệu trình phi kim hướng tới từng nhu cầu riêng: cấp ẩm, sáng da, lỗ chân lông hay phục hồi da yếu.', match: 'MTS', title: 'Phi kim MTS', tags: 'Lỗ chân lông / Đều màu / Căng bóng', image: 'phi-kim' },
  { slug: 'vung-mat', intro: 'Chăm sóc riêng cho vùng da mỏng quanh mắt, kết hợp thư giãn.', match: 'Eyezone', title: 'Chăm sóc vùng mắt', tags: 'Thư giãn / Săn chắc / Trẻ hoá', image: 'vung-mat' },
  { slug: 'body', intro: 'Chăm sóc da body theo nhu cầu: sáng da, mụn lưng, phục hồi sau nắng.', match: 'Body', title: 'Chăm sóc body', tags: 'Sáng da / Mụn lưng / Sau nắng', image: 'body' },
  { slug: 'toc-da-dau', intro: 'Gội đầu thư giãn và chăm sóc da đầu cùng sản phẩm Oway.', match: 'Hair & Scalp', title: 'Tóc & da đầu', tags: 'Gội đầu / Detox da đầu / Tóc rụng', image: 'thu-gian' },
  { slug: 'triet-long', intro: 'Triệt lông theo từng vùng, từ mặt đến toàn thân.', match: 'Triệt lông', title: 'Triệt lông', tags: 'Mặt / Nách / Tay chân / Toàn thân', image: 'hoa-thu-gian' },
];

// Liệu trình nổi bật trên trang chủ: khớp theo tên tiếng Anh (name_en) trong app.
export const FEATURED = [
  { nameEn: 'DETOX SKIN', group: 'Chăm sóc da cơ bản', slug: 'cham-soc-da-co-ban' },
  { nameEn: 'SOIN LISSANT', group: 'Biologique Recherche', slug: 'biologique-recherche' },
  { nameEn: 'GLOW PEELING', group: 'Peel', slug: 'peel' },
  { nameEn: 'GLOW MTS', group: 'Phi kim MTS', slug: 'phi-kim' },
];

// 4 sản phẩm BR giới thiệu trên trang chủ (theo mã SP). Thiếu mã nào thì lấy sản phẩm khác cùng danh sách web.
export const HOME_PRODUCTS = ['LOP5150', 'MAVIV100', 'FLVIPO230', 'CRGM50'];

// Tên hiển thị riêng trên website cho vài liệu trình (theo guideline: hạn chế HIFU, không hứa kết quả).
// Khoá = tên tiếng Anh (name_en) trong app. Khi đã đổi tên trong app thì có thể xoá dòng tương ứng ở đây.
export const WEB_NAMES = {
  'EYE LIFT': 'Săn chắc vùng mắt',
  'EYE FIRM': 'Trẻ hoá vùng mắt (RF)',
};

// Nhóm sản phẩm trên trang Sản phẩm (khớp cột category trong app), theo thứ tự hiển thị.
export const PRODUCT_CATS = [
  { key: 'SỮA RỬA MẶT', label: 'Sữa rửa mặt', area: 'Mặt' },
  { key: 'TẨY TRANG', label: 'Tẩy trang', area: 'Mặt' },
  { key: 'LOTION', label: 'Lotion', area: 'Mặt' },
  { key: 'TONER', label: 'Toner', area: 'Mặt' },
  { key: 'SERUM', label: 'Serum', area: 'Mặt' },
  { key: 'KEM DƯỠNG', label: 'Kem dưỡng', area: 'Mặt' },
  { key: 'KEM MẮT', label: 'Kem mắt', area: 'Mặt' },
  { key: 'MẶT NẠ', label: 'Mặt nạ', area: 'Mặt' },
  { key: 'KEM CHỐNG NẮNG', label: 'Kem chống nắng', area: 'Mặt' },
  { key: 'DƯỠNG MÔI', label: 'Dưỡng môi', area: 'Mặt' },
  { key: 'CHĂM SÓC CƠ THỂ', label: 'Cơ thể', area: 'Cơ thể' },
  { key: 'CHĂM SÓC TÓC', label: 'Tóc', area: 'Tóc' },
];

// Ảnh minh hoạ cho combo theo nhóm combo (khớp đầu tên nhóm trong app).
export const COMBO_IMAGES = [
  { match: 'Chăm sóc da cơ bản', image: 'co-ban' },
  { match: 'Mụn', image: 'phi-kim' },
  { match: 'Sáng da', image: 'peel' },
  { match: 'Tóc', image: 'thu-gian' },
  { match: 'Triệt lông', image: 'hoa-thu-gian' },
  { match: 'Biologique', image: 'biologique' },
];
