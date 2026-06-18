import { buildFilename, buildMonthFolderName, DEFAULT_CONFIG } from "@/config/defaults";
import type { AppConfig } from "@/types";

const cfg = DEFAULT_CONFIG;

// ── buildMonthFolderName ──────────────────────────────────────────────────────

describe("buildMonthFolderName", () => {
  it("formats YYYY年MM月 mode from ISO input", () => {
    expect(buildMonthFolderName("2024-03", cfg)).toBe("2024年03月");
  });

  it("zero-pads single-digit month", () => {
    expect(buildMonthFolderName("2024-3", cfg)).toBe("2024年03月");
  });

  it("formats YYYY-MM mode", () => {
    const c: AppConfig = { ...cfg, monthFolderNamingMode: "YYYY-MM" };
    expect(buildMonthFolderName("2024-03", c)).toBe("2024-03");
  });

  it("formats custom template with {YYYY}/{MM}", () => {
    const c: AppConfig = {
      ...cfg,
      monthFolderNamingMode: "custom",
      monthFolderCustomTemplate: "{YYYY}/{MM}",
    };
    expect(buildMonthFolderName("2024-03", c)).toBe("2024/03");
  });

  it("parses Japanese input for custom template", () => {
    const c: AppConfig = {
      ...cfg,
      monthFolderNamingMode: "custom",
      monthFolderCustomTemplate: "{YYYY}/{MM}",
    };
    expect(buildMonthFolderName("2024年3月", c)).toBe("2024/03");
  });

  it("falls back to raw value when input is unparseable", () => {
    expect(buildMonthFolderName("unknown-month", cfg)).toBe("unknown-month");
  });
});

// ── buildFilename ─────────────────────────────────────────────────────────────

describe("buildFilename", () => {
  it("applies the default template {payerName}_{originalFilename}", () => {
    const result = buildFilename(cfg, {
      payerName: "田中 太郎",
      originalFilename: "invoice.pdf",
      closingMonth: "2024-03",
    });
    expect(result).toBe("田中 太郎_invoice.pdf");
  });

  it("appends .pdf when missing from result", () => {
    const result = buildFilename(cfg, {
      payerName: "田中",
      originalFilename: "invoice",
      closingMonth: "2024-03",
    });
    expect(result).toMatch(/\.pdf$/);
  });

  it("does not double-append .pdf", () => {
    const result = buildFilename(cfg, {
      payerName: "田中",
      originalFilename: "invoice.pdf",
      closingMonth: "2024-03",
    });
    expect(result.toLowerCase().split(".pdf").length).toBe(2); // exactly one .pdf
  });

  it("replaces illegal filename characters with underscore", () => {
    const result = buildFilename(cfg, {
      payerName: "株式会社A/B",
      originalFilename: "inv:oice.pdf",
      closingMonth: "2024-03",
    });
    expect(result).not.toMatch(/[\\/:*?"<>|]/);
    expect(result).toContain("株式会社A_B");
  });

  it("supports {closingMonth} token in custom template", () => {
    const c: AppConfig = { ...cfg, filenameRule: "{closingMonth}_{payerName}_{originalFilename}" };
    const result = buildFilename(c, {
      payerName: "田中",
      originalFilename: "invoice.pdf",
      closingMonth: "2024-03",
    });
    expect(result).toBe("2024-03_田中_invoice.pdf");
  });
});
