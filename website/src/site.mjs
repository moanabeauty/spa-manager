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
  { slug: 'cham-soc-da-co-ban', match: 'Essential Treatment', title: 'Chăm sóc da cơ bản', tags: 'Làm sạch sâu / Cấp ẩm / Làm dịu', image: 'co-ban' },
  { slug: 'biologique-recherche', match: 'Biologique Recherche', title: 'Biologique Recherche', tags: 'Cấp ẩm / Phục hồi / Nâng cơ', image: 'biologique' },
  { slug: 'peel', match: 'Chemical Peel', title: 'Peel căng bóng', tags: 'Căng bóng / Đều màu da', image: 'peel' },
  { slug: 'phi-kim', match: 'MTS', title: 'Phi kim MTS', tags: 'Lỗ chân lông / Đều màu / Căng bóng', image: 'phi-kim' },
  { slug: 'vung-mat', match: 'Eyezone', title: 'Chăm sóc vùng mắt', tags: 'Thư giãn / Săn chắc / Trẻ hoá', image: 'vung-mat' },
  { slug: 'body', match: 'Body', title: 'Chăm sóc body', tags: 'Sáng da / Mụn lưng / Sau nắng', image: 'body' },
  { slug: 'toc-da-dau', match: 'Hair & Scalp', title: 'Tóc & da đầu', tags: 'Gội đầu / Detox da đầu / Tóc rụng', image: 'thu-gian' },
  { slug: 'triet-long', match: 'Triệt lông', title: 'Triệt lông', tags: 'Mặt / Nách / Tay chân / Toàn thân', image: 'hoa-thu-gian' },
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
