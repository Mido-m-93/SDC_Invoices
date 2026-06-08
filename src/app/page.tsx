// src/app/page.tsx — Redirect root to dashboard
import { redirect } from "next/navigation";

export default function RootPage() {
  redirect("/dashboard");
}
