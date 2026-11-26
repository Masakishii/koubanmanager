import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "工番・現場管理ハブ",
  description: "工番・元請け・顧客・出向者・履歴の一元整理 ＆ 各現場アプリ連携",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className="antialiased bg-slate-100 text-slate-800">{children}</body>
    </html>
  );
}