"use client";

import PaymentDirectionPage from "@/components/payment-records/PaymentDirectionPage";
import { useLanguage } from "@/translations";

export default function CashPaymentPage() {
  const { t } = useLanguage();
  return (
    <PaymentDirectionPage
      direction="payment"
      title={t("cash_payment_title")}
      subtitle={t("cash_payment_subtitle")}
    />
  );
}
