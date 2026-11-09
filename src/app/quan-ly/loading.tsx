// Hiện ngay khi bấm chuyển trang (thanh menu giữ nguyên), trong lúc máy chủ lấy dữ liệu.
// Có file này Next.js mới tải trước được các trang khi link xuất hiện trên màn hình → bấm là mở nhanh.
export default function Loading() {
  return (
    <div className="space-y-3 animate-pulse" aria-busy="true" aria-label="Đang tải">
      <div className="h-7 w-48 rounded-lg bg-beige/70" />
      <div className="card space-y-3">
        <div className="h-4 w-3/4 rounded bg-beige/70" />
        <div className="h-4 w-1/2 rounded bg-beige/70" />
        <div className="h-4 w-2/3 rounded bg-beige/70" />
      </div>
      <div className="card space-y-3">
        <div className="h-4 w-2/3 rounded bg-beige/70" />
        <div className="h-4 w-1/3 rounded bg-beige/70" />
      </div>
    </div>
  );
}
