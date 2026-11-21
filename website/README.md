# Website Moana Beauty (moanabeauty.vn)

Website giới thiệu, tách riêng với app quản lý (thư mục gốc của repo). Là trang tĩnh, dựng bằng `node build.mjs` — không cần cài thư viện.

- Dữ liệu liệu trình / combo / sản phẩm / ưu đãi / bài viết lấy **lúc build** từ app (Supabase), chỉ các mục công khai:
  `web_services()`, `web_packages()`, `web_products()`, bảng `promotions` (show_online) và `posts` (đã đăng).
  Sửa trong app → cần build lại website (Vercel: Redeploy) để cập nhật.
- Không kết nối được Supabase thì dùng bản sao `data/fallback.json`.
- Thông tin cố định (hotline, địa chỉ, menu, nhóm liệu trình + lời giới thiệu nhóm, liệu trình nổi bật, 4 sản phẩm trang chủ, nhóm sản phẩm, tên hiển thị riêng trên web `WEB_NAMES`): `src/site.mjs`.
- Trang: trang chủ (`pages/home.mjs`); liệu trình, combo, bảng giá (`pages/catalog.mjs`); sản phẩm (`pages/products.mjs`); về Moana, ưu đãi & tin tức, chính sách bảo mật, liên hệ, 404 (`pages/other.mjs`).
- Đường dẫn chi tiết tự sinh: `/lieu-trinh/<tên tiếng Việt>`, `/combo/<tên combo>`, `/san-pham/<mã SP>`, `/tin-tuc/<slug bài viết>`. Đổi tên trong app sẽ đổi đường dẫn.
- Giá liệu trình & combo chỉ hiện ở `/bang-gia`; giá sản phẩm hiện ở trang sản phẩm.
- Giao diện: `src/assets/site.css`; trang: `src/pages/`; ảnh: `public/images/` (từ thư mục Photo trên Drive).
- Vercel: dự án riêng, Root Directory = `website`, cấu hình trong `vercel.json` (cleanUrls, chuyển hướng link WordPress cũ, cache ảnh).

- IndexNow (Bing, Yandex…): mỗi lần deploy Production, `build.mjs` so nội dung từng trang với bản đang chạy (`/indexnow-state.json`) rồi tự gửi các trang mới/đổi/bị xoá lên IndexNow; `sitemap.xml` giữ đúng ngày sửa cuối (lastmod) từng trang. Khoá: `src/indexnow.mjs` (file `/<khoá>.txt` tự sinh khi build). Dùng dữ liệu dự phòng thì không gửi.

Chạy thử trên máy: `node build.mjs` rồi mở `dist/index.html` (hoặc `npx serve dist`).
