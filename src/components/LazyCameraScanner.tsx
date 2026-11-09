"use client";
// Máy quét mã vạch chỉ tải khi người dùng bấm nút quét → trang mở nhanh hơn, không tải sẵn phần camera.
import dynamic from "next/dynamic";

const CameraScanner = dynamic(() => import("./CameraScanner"), { ssr: false });
export default CameraScanner;
