import { describe, expect, it } from "vitest";
import { buildReportFilename } from "./filename";

describe("buildReportFilename", () => {
  it("mengikuti struktur {report}_{scope}_{period}_{generated}.pdf", () => {
    expect(
      buildReportFilename({
        reportName: "Rincian-Penjualan",
        unitCode: "6478111",
        period: "2026-06-11",
        generated: "2026-07-01",
      }),
    ).toBe("Rincian-Penjualan_SPBU-6478111_2026-06-11_2026-07-01.pdf");
  });

  it("mensanitasi spasi & karakter tak aman menjadi dash", () => {
    expect(
      buildReportFilename({
        reportName: "Rincian Penjualan",
        unitCode: "64.781.11",
        period: "2026/06/11",
        generated: "2026-07-01",
      }),
    ).toBe("Rincian-Penjualan_SPBU-64-781-11_2026-06-11_2026-07-01.pdf");
  });

  it("mendukung scope multi-unit (board) via override", () => {
    expect(
      buildReportFilename({
        reportName: "Ringkasan-Direksi",
        scope: "PT Sola Petra Abadi",
        period: "2026-07-02",
        generated: "2026-07-02",
      }),
    ).toBe("Ringkasan-Direksi_PT-Sola-Petra-Abadi_2026-07-02_2026-07-02.pdf");
  });

  it("tidak menghasilkan segmen kosong / dash beruntun / dash tepi", () => {
    const name = buildReportFilename({
      reportName: "  ",
      unitCode: "**",
      period: "--2026--",
      generated: "2026-07-01",
    });
    expect(name).toBe("x_SPBU-x_2026_2026-07-01.pdf");
    expect(name).not.toMatch(/__|--|_-|-_/);
  });
});
