import type { KnipConfig } from "knip";

const config: KnipConfig = {
  // Entry points Next.js App Router already knows about
  entry: [
    "src/app/**/page.tsx",
    "src/app/**/layout.tsx",
    "src/app/**/route.ts",
  ],
  project: ["src/**/*.{ts,tsx}", "e2e/**/*.{ts,tsx}"],
  // Jest test files — counted as entry points so their imports mark exports as "used"
  jest: {
    config: ["jest.config.ts"],
    entry: ["src/__tests__/**/*.test.ts"],
  },
  // Playwright e2e tests
  playwright: {
    config: ["e2e/playwright.config.ts"],
    entry: ["e2e/**/*.spec.ts"],
  },
  ignore: [
    // UI components staged for a future settings/form redesign
    "src/components/ui/FormField.tsx",
    "src/components/ui/UserPickerModal.tsx",
    // Services built for future notification phases — not yet wired to a caller
    "src/lib/services/real/EmailNotificationService.ts",
    "src/lib/services/real/SlackNotificationService.ts",
    "src/lib/services/real/MultiChannelNotificationService.ts",
    "src/lib/services/real/FirestoreService.ts",
    "src/lib/services/real/SupabaseOutboundService.ts",
    "src/lib/services/real/ValidationService.ts",
    "src/lib/services/mock/outboundService.ts",
    "src/lib/services/mock/mockData.ts",
  ],
  ignoreDependencies: [
    // Loaded at runtime via env-gated service factories, not static imports
    "@azure/identity",
    "@microsoft/microsoft-graph-client",
    "google-auth-library",
  ],
};

export default config;
