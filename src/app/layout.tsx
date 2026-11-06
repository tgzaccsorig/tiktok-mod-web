import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TikTok Mod Web",
  description: "Вертикальная лента публичных видео TikTok с профилями и сообществом.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#000000",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <head>
        {/* заранее открываем соединение с плеером TikTok — первый ролик стартует быстрее */}
        <link rel="preconnect" href="https://www.tiktok.com" />
        <link rel="dns-prefetch" href="https://www.tiktok.com" />
      </head>
      <body>
        {children}
        <a
          href="/updates"
          className="fixed right-3 top-24 z-50 rounded-full border border-white/20 bg-black/75 px-3 py-2 text-xs font-semibold text-white shadow-lg backdrop-blur transition hover:bg-white/15"
        >
          Обновления
        </a>
      </body>
    </html>
  );
}
