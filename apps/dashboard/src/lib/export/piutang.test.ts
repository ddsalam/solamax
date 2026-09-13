import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPiutangDoc, piutangCsv, safeSpreadsheetText } from "./piutang";
import { renderPdfBuffer } from "./server-pdf";
import { buildPiutangExportView, type PiutangExportView } from "@/lib/piutang-model";
import type { SaldoSnapshot } from "@/lib/saldo-snapshot";

const snapshot: Extract<SaldoSnapshot, { status: "ready" }> = {
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
    debetTotals: { awal: { piutangLokal: 8.25, piutangOnline: 10.5, hutangLokal: 9.75 }, akhir: { piutangLokal: 11.25, piutangOnline: 13.5, hutangLokal: 9.75 } },
    kreditTotals: { awal: { piutangLokal: 7.25, piutangOnline: 8.5, hutangLokal: 12.75 }, akhir: { piutangLokal: 7.25, piutangOnline: 8.5, hutangLokal: 15.75 } },
    totals: {
      awal: { piutangLokal: 1, piutangOnline: 2, hutangLokal: -3 },
      akhir: { piutangLokal: 4, piutangOnline: 5, hutangLokal: -6 },
    },
  },
  rows: [
    {
      awalPiutangLokalDebet: 7.25, awalPiutangLokalKredit: 7.25, akhirPiutangLokalDebet: 7.25, akhirPiutangLokalKredit: 7.25,
      awalPiutangOnlineDebet: 8.5, awalPiutangOnlineKredit: 8.5, akhirPiutangOnlineDebet: 8.5, akhirPiutangOnlineKredit: 8.5,
      awalHutangLokalDebet: 9.75, awalHutangLokalKredit: 9.75, akhirHutangLokalDebet: 9.75, akhirHutangLokalKredit: 9.75,
      customerCode: "NOL/02", customerName: "=HYPERLINK(\"x\")",
      awalPiutangLokal: 0, akhirPiutangLokal: 0, awalPiutangOnline: 0,
      akhirPiutangOnline: 0, awalHutangLokal: 0, akhirHutangLokal: 0,
    },
    {
      awalPiutangLokalDebet: 1, awalPiutangLokalKredit: 0, akhirPiutangLokalDebet: 4, akhirPiutangLokalKredit: 0,
      awalPiutangOnlineDebet: 2, awalPiutangOnlineKredit: 0, akhirPiutangOnlineDebet: 5, akhirPiutangOnlineKredit: 0,
      awalHutangLokalDebet: 0, awalHutangLokalKredit: 3, akhirHutangLokalDebet: 0, akhirHutangLokalKredit: 6,
      customerCode: "21.1", customerName: "Online",
      awalPiutangLokal: 1, akhirPiutangLokal: 4, awalPiutangOnline: 2,
      akhirPiutangOnline: 5, awalHutangLokal: -3, akhirHutangLokal: -6,
    },
  ],
  hasOnlineCustomer: true,
};
function exportView(snapshot: SaldoSnapshot): PiutangExportView {
  const result = buildPiutangExportView(snapshot, {});
  if (result.status !== "ready") throw new Error("expected ready");
  return result;
}
const view = exportView(snapshot);

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

  it("writes each book triplet once, including gross turnover for zero customers", () => {
    const csv = piutangCsv({ unit: { code: "6478111", name: "=Unit" }, ptLabel: "PT Sola Petra Abadi", view, generatedLabel: "sekarang", generatedBy: "dion@example.com" });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("'=Unit");
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("NOL/02");
    expect(csv).toContain(",7.25,7.25,0,7.25,7.25,0\r\n");
    expect(csv).toContain("keenam saldo Awal/Akhir nol");
    expect(csv).toContain("Tanpa saldo di ketiga buku,Piutang Lokal");
    expect(csv.match(/NOL\/02/g)).toHaveLength(3);
    const data = csv.split("\r\n").filter((line) => line.startsWith("6478111,"));
    expect(data).toHaveLength(6);
    expect(data[0]).toContain("Piutang Lokal,Piutang Lokal");
    expect(data[0]).toMatch(/,1,0,1,4,0,4$/);
    expect(data[1]).toContain("Piutang Online,Piutang Online");
    expect(data[1]).toMatch(/,2,0,2,5,0,5$/);
    expect(data[2]).toContain("Hutang Lokal,Hutang Lokal");
    expect(data[2]).toMatch(/,0,3,-3,0,6,-6$/);
    expect(data[3]).toMatch(/,7.25,7.25,0,7.25,7.25,0$/);
    expect(data[4]).toContain("Piutang Online");
    expect(data[5]).toContain("Hutang Lokal");
  });

  it("builds a landscape PDF table with separate bucket columns and page footer", () => {
    const doc = buildPiutangDoc({
      kop: { ptLabel: "PT Sola Petra Abadi", judul: "Daftar Saldo Hutang Piutang per Pelanggan", subjudul: "SPBU 6478111 · Imam Bonjol · Tanggal 2026-09-09", generatedLabel: "10 Sep 2026 · 18.00", dicetakOleh: "dion@example.com" },
      view,
    });
    expect(doc.pageOrientation).toBe("landscape");
    expect(JSON.stringify(doc)).toContain("Awal Debet");
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
    const withLigatures = exportView({
      ...snapshot,
      rows: snapshot.rows.map((row, index) => index === 1
        ? { ...row, customerName: "Pelanggan fisik final" }
        : row),
    });
    const buffer = await renderPdfBuffer(buildPiutangDoc({
      kop: { ptLabel: "PT Sola Petra Abadi", judul: "Daftar Saldo Hutang Piutang per Pelanggan", subjudul: "SPBU 6478111 · Imam Bonjol · Tanggal 2026-09-09", generatedLabel: "10 Sep 2026 · 18.00", dicetakOleh: "dion@example.com" },
      view: withLigatures,
    }));
    expect(pdfText(buffer)).toContain("Pelanggan fisik final");
  });
});


it("keeps CSV decimal values exact and the existing PDF rounding unchanged", () => {
  const precise = exportView({
    ...snapshot,
    rows: [{ ...snapshot.rows[1]!, awalPiutangLokal: 13_052_684_187.5, akhirPiutangLokal: 13_052_684_187.5 }],
  });
  const csv = piutangCsv({ unit: { code: "IB", name: "Imam Bonjol" }, ptLabel: "PT", view: precise, generatedLabel: "sekarang", generatedBy: "Dion" });
  expect(csv).toContain(",1,0,13052684187.5,4,0,13052684187.5\r\n");
  const doc = buildPiutangDoc({
    kop: { ptLabel: "PT", judul: "Piutang", subjudul: "IB", generatedLabel: "sekarang", dicetakOleh: "Dion" },
    view: precise,
  });
  expect(JSON.stringify(doc)).toContain("13.052.684.188");
});

it("keeps PDF section order identical to CSV, including an empty zero section", () => {
  const selected = buildPiutangExportView(snapshot, { filter: "bersaldo" });
  if (selected.status !== "ready") throw new Error("expected ready");
  const doc = buildPiutangDoc({
    kop: { ptLabel: "PT", judul: "Piutang", subjudul: "IB", generatedLabel: "sekarang", dicetakOleh: "Dion" },
    view: selected,
  });
  const content = JSON.stringify(doc);
  const positions = selected.sections.map((section) => content.indexOf(`${section.title} · ${section.rows.length}`));
  expect(positions.every((value) => value >= 0)).toBe(true);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
  expect(content).toContain("Tanpa saldo di ketiga buku · 0 pelanggan");
});

it("exports gross turnover in an inactive book exactly once alongside the first active book", async () => {
  const sample = exportView({ ...snapshot, rows: [{ ...snapshot.rows[1]!,
    awalHutangLokal: 0, akhirHutangLokal: 0,
    awalHutangLokalDebet: 71.25, awalHutangLokalKredit: 71.25,
    akhirHutangLokalDebet: 71.25, akhirHutangLokalKredit: 71.25,
  }] });
  const csv = piutangCsv({ unit: { code: "IB", name: "Imam Bonjol" }, ptLabel: "PT", view: sample, generatedLabel: "sekarang", generatedBy: "Dion" });
  const data = csv.split("\r\n").filter((line) => line.startsWith("IB,"));
  expect(data).toHaveLength(3);
  expect(data[0]).toContain("Piutang Lokal,Piutang Lokal");
  expect(data[1]).toContain("Piutang Lokal,Hutang Lokal");
  expect(data[1]).toContain("buku bersaldo nol");
  expect(data[1]).toMatch(/,71.25,71.25,0,71.25,71.25,0$/);
  expect(data[2]).toContain("Piutang Online,Piutang Online");
  const doc = buildPiutangDoc({ kop: { ptLabel: "PT", judul: "Piutang", subjudul: "IB", generatedLabel: "sekarang", dicetakOleh: "Dion" }, view: sample });
  expect(JSON.stringify(doc).match(/71,25/g)).toHaveLength(4);
  expect(JSON.stringify(doc)).toContain("buku bersaldo nol");
  const buffer = await renderPdfBuffer(doc);
  expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  if (hasPdftotext) expect(pdfText(buffer).match(/71,25/g)).toHaveLength(4);
});

it("preserves audited IB gross half units in PDF and exact CSV totals", () => {
  const sample = exportView({ ...snapshot, rows: [], metadata: { ...snapshot.metadata,
    totals: { awal: { piutangLokal: 13052684187.5, piutangOnline: 900000, hutangLokal: -673010538 }, akhir: { piutangLokal: 13052684187.5, piutangOnline: 900000, hutangLokal: -673010538 } },
    debetTotals: { awal: { piutangLokal: 122345938294, piutangOnline: 10505841, hutangLokal: 53549062678.5 }, akhir: { piutangLokal: 122345938294, piutangOnline: 10505841, hutangLokal: 53549062678.5 } },
    kreditTotals: { awal: { piutangLokal: 109293254106.5, piutangOnline: 9605841, hutangLokal: 54222073216.5 }, akhir: { piutangLokal: 109293254106.5, piutangOnline: 9605841, hutangLokal: 54222073216.5 } },
  } });
  const csv = piutangCsv({ unit: { code: "IB", name: "Imam Bonjol" }, ptLabel: "PT", view: sample, generatedLabel: "sekarang", generatedBy: "Dion" });
  expect(csv).toContain("Piutang Lokal,122345938294,109293254106.5,13052684187.5,122345938294,109293254106.5,13052684187.5");
  const doc = JSON.stringify(buildPiutangDoc({ kop: { ptLabel: "PT", judul: "Piutang", subjudul: "IB", generatedLabel: "sekarang", dicetakOleh: "Dion" }, view: sample }));
  expect(doc).toContain("109.293.254.106,5"); expect(doc).toContain("53.549.062.678,5");
  expect(doc).toContain("54.222.073.216,5"); expect(doc).toContain("13.052.684.188");
});
