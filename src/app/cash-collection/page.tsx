"use client";

import PaymentDirectionPage from "@/components/payment-records/PaymentDirectionPage";
import { useLanguage } from "@/translations";

export default function CashCollectionPage() {
  const { t } = useLanguage();
  return (
    <PaymentDirectionPage
      direction="collection"
      title={t("cash_collection_title")}
      subtitle={t("cash_collection_subtitle")}
    />
  );
}
