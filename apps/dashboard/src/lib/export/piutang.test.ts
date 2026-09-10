import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPiutangDoc, piutangCsv, safeSpreadsheetText } from "./piutang";
import { renderPdfBuffer } from "./server-pdf";
import type { PiutangExportView } from "@/lib/piutang-model";

const view: PiutangExportView = {
  status: "ready",
  asOfDate: "2026-09-09",
  metadata: {
    generationId: "generation-1",
    rowCount: 2,
    formulaVersion: "saldo-pelanggan-v1",
    computedAt: "2026-09-09T03:01:00Z",
    sourceCycleId: "cycle-1",
    sourceCompletedAt: "2026-09-09T03:00:00Z",
    pendingReplacement: false,
    staleInvalidFrom: null,
    totals: {
      awal: { piutangLokal: 1, piutangOnline: 2, hutangLokal: -3 },
      akhir: { piutangLokal: 4, piutangOnline: 5, hutangLokal: -6 },
    },
  },
  rows: [
    {
      customerCode: "NOL/02", customerName: "=HYPERLINK(\"x\")", isZeroBalance: true,
      awalPiutangLokal: 0, akhirPiutangLokal: 0, awalPiutangOnline: 0,
      akhirPiutangOnline: 0, awalHutangLokal: 0, akhirHutangLokal: 0,
    },
    {
      customerCode: "21.1", customerName: "Online", isZeroBalance: false,
      awalPiutangLokal: 1, akhirPiutangLokal: 4, awalPiutangOnline: 2,
      akhirPiutangOnline: 5, awalHutangLokal: -3, akhirHutangLokal: -6,
    },
  ],
  hasOnlineCustomer: true,
  totalCount: 2,
  resultCount: 2,
  filter: "semua",
  sort: "default",
  search: "",
};

let hasPdftotext = false;
try {
  execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
  hasPdftotext = true;
} catch {
  hasPdftotext = false;
}

function pdfText(buffer: Buffer): string {
  const file = join(mkdtempSync(join(tmpdir(), "piutang-pdf-")), "report.pdf");
  writeFileSync(file, buffer);
  return execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
}

describe("piutang export", () => {
  it.each(["=x", " +x", "-2", "@x", "\ttext", "\rtext"])("neutralises spreadsheet formula text %j", (value) => {
    expect(safeSpreadsheetText(value)).toBe(`'${value}`);
  });

  it("writes all six balances as numeric cells, including explicit zero", () => {
    const csv = piutangCsv({ unit: { code: "6478111", name: "=Unit" }, ptLabel: "PT Sola Petra Abadi", view, generatedLabel: "sekarang", generatedBy: "dion@example.com" });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("'=Unit");
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("NOL/02");
    expect(csv).toContain(",0,0,0,0,0,0\r\n");
    expect(csv).toContain(",1,4,2,5,-3,-6\r\n");
  });

  it("builds a landscape PDF table with separate bucket columns and page footer", () => {
    const doc = buildPiutangDoc({
      kop: { ptLabel: "PT Sola Petra Abadi", judul: "Daftar Saldo Hutang Piutang per Pelanggan", subjudul: "SPBU 6478111 · Imam Bonjol · Tanggal 2026-09-09", generatedLabel: "10 Sep 2026 · 18.00", dicetakOleh: "dion@example.com" },
      view,
    });
    expect(doc.pageOrientation).toBe("landscape");
    expect(JSON.stringify(doc)).toContain("Online awal");
    expect(JSON.stringify(doc)).toContain("tidak dijumlahkan/netto");
    expect(typeof doc.footer).toBe("function");
  });

  it("renders the authenticated-server document as a real PDF buffer", async () => {
    const doc = buildPiutangDoc({
      kop: { ptLabel: "PT Sola Petra Abadi", judul: "Daftar Saldo Hutang Piutang per Pelanggan", subjudul: "SPBU 6478111 · Imam Bonjol · Tanggal 2026-09-09", generatedLabel: "10 Sep 2026 · 18.00", dicetakOleh: "dion@example.com" },
      view,
    });
    const buffer = await renderPdfBuffer(doc);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buffer.byteLength).toBeGreaterThan(5_000);
  });
});

const describePdfText = hasPdftotext ? describe : describe.skip;
describePdfText("piutang server PDF text extraction", () => {
  it("preserves fi/fl text through the shared ligature defaults", async () => {
    const withLigatures: PiutangExportView = {
      ...view,
      rows: view.rows.map((row, index) => index === 1
        ? { ...row, customerName: "Pelanggan fisik final" }
        : row),
    };
    const buffer = await renderPdfBuffer(buildPiutangDoc({
      kop: { ptLabel: "PT Sola Petra Abadi", judul: "Daftar Saldo Hutang Piutang per Pelanggan", subjudul: "SPBU 6478111 · Imam Bonjol · Tanggal 2026-09-09", generatedLabel: "10 Sep 2026 · 18.00", dicetakOleh: "dion@example.com" },
      view: withLigatures,
    }));
    expect(pdfText(buffer)).toContain("Pelanggan fisik final");
  });
});
