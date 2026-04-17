// src/app/layout.tsx
import type { Metadata } from "next";
import { LanguageProvider } from "@/translations";
import "./globals.css";

export const metadata: Metadata = {
  title: "業務委託請求書確認・保管ツール | SDC",
  description: "Contractor Invoice Verification & Filing Tool",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // Font variables are set in globals.css via @import or <link> in production
    // For dev/build without internet: falls back to system sans/mono gracefully
    <html lang="ja">
      <head>
        {/*
          In production (with internet), add Google Fonts here:
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
        */}
      </head>
      <body className="bg-stone-50 text-stone-900 antialiased">
        <LanguageProvider defaultLanguage="ja">
          {children}
        </LanguageProvider>
      </body>
    </html>
  );
}
