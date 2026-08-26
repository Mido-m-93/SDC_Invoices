import type { Metadata } from "next";
import type { ReactNode } from "react";
import { LanguageProvider } from "@/translations";
import { NotificationsProvider } from "@/lib/notifications";
import "./globals.css";

export const metadata: Metadata = {
  title: "業務委託請求書確認・保管ツール | SDC",
  description: "Contractor Invoice Verification & Filing Tool",
  other: {
    google: "notranslate",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja" translate="no" className="notranslate">
      <body className="bg-white text-stone-900 antialiased">
        <LanguageProvider defaultLanguage="ja">
          <NotificationsProvider>{children}</NotificationsProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
