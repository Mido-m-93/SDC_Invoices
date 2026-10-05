import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { LanguageProvider } from "@/translations";
import { LANGUAGE_COOKIE } from "@/translations/constants";
import type { Language } from "@/types";
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
  const stored = cookies().get(LANGUAGE_COOKIE)?.value;
  const language: Language = stored === "en" ? "en" : "ja";

  return (
    <html lang={language} translate="no" className="notranslate">
      <body className="bg-white text-stone-900 antialiased">
        <LanguageProvider defaultLanguage={language}>
          <NotificationsProvider>{children}</NotificationsProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
