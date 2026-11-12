import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro, Playfair_Display } from "next/font/google";
import Header from "@/components/Header";
import "./globals.css";

const font = Be_Vietnam_Pro({
  subsets: ["vietnamese", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-be-vietnam",
  display: "swap",
});

// Chữ tiêu đề có chân, sang trọng – Playfair Display hiển thị dấu tiếng Việt rõ ràng
const display = Playfair_Display({
  subsets: ["vietnamese", "latin"],
  weight: ["500", "600", "700"],
  variable: "--font-playfair",
  display: "swap",
});

const THEME_SCRIPT = `try{if(localStorage.getItem("moana-theme")==="dark")document.documentElement.classList.add("dark")}catch(e){}`;

export const metadata: Metadata = {
  title: "Moana Beauty – Đặt lịch",
  description: "Đặt lịch chăm sóc da tại Moana Beauty: 67 Lưu Quang Vũ và 109 Nguyễn Sơn, Hà Nội",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Moana", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#F7F4ED",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={`${font.variable} ${display.variable}`} suppressHydrationWarning>
      <head>
        {/* chế độ tối của khu nhân viên: bật trước khi trang hiện để không nháy trắng */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <Header />
        <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-6">{children}</main>
      </body>
    </html>
  );
}
