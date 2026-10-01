"use client";

import type { ReactNode } from "react";
import AppShell from "@/components/layout/AppShell";

// Shared layout for every authenticated route — keeps AppShell (sidebar,
// user session) mounted once across navigation instead of every page
// remounting it individually, which caused a full-page blank flash on
// every click (the sidebar and its user/permissions fetch tore down and
// rebuilt from scratch on every single navigation).
export default function AppGroupLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
