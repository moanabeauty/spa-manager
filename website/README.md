# Website Moana Beauty (moanabeauty.vn)

Website giới thiệu, tách riêng với app quản lý (thư mục gốc của repo). Là trang tĩnh, dựng bằng `node build.mjs` — không cần cài thư viện.

- Dữ liệu liệu trình / combo / sản phẩm / ưu đãi / bài viết lấy **lúc build** từ app (Supabase), chỉ các mục công khai:
  `web_services()`, `web_packages()`, `web_products()`, bảng `promotions` (show_online) và `posts` (đã đăng).
  Sửa trong app → cần build lại website (Vercel: Redeploy) để cập nhật.
- Không kết nối được Supabase thì dùng bản sao `data/fallback.json`.
- Thông tin cố định (hotline, địa chỉ, menu, nhóm liệu trình, liệu trình nổi bật, 4 sản phẩm trang chủ): `src/site.mjs`.
- Giao diện: `src/assets/site.css`; trang: `src/pages/`; ảnh: `public/images/` (từ thư mục Photo trên Drive).
- Vercel: dự án riêng, Root Directory = `website`, cấu hình trong `vercel.json` (cleanUrls, chuyển hướng link WordPress cũ, cache ảnh).

Chạy thử trên máy: `node build.mjs` rồi mở `dist/index.html` (hoặc `npx serve dist`).
