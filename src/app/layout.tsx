import type { Metadata } from "next";
import type { ReactNode } from "react";
import { LanguageProvider } from "@/translations";
import "./globals.css";

export const metadata: Metadata = {
  title: "業務委託請求書確認・保管ツール | SDC",
  description: "Contractor Invoice Verification & Filing Tool",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body className="bg-white text-stone-900 antialiased">
        <LanguageProvider defaultLanguage="ja">{children}</LanguageProvider>
      </body>
    </html>
  );
}
