/**
 * Verifikasi penanda WAJIB Laporan Harian PDF (Gate PDF-B). DUA lapis:
 *
 *  (1) DOC-TREE (jalan di CI): walk pohon docDefinition, kumpulkan SEMUA string
 *      `text` (termasuk footer(1,3)), buktikan penanda HADIR saat flag di-set &
 *      ABSEN saat lengkap — dua arah. Teks pdfmake selalu dirender apa adanya
 *      (risiko render ada di CANVAS, bukan teks — canvas diuji byte-level di
 *      harian-charts.render.test.ts via inflate, tanpa font, jalan di CI).
 *
 *  (2) BYTE-LEVEL via pdftotext (di-skip bila tak tersedia, mis. CI runner):
 *      membaca PDF hasil seperti manusia — bukti terkuat teks bertahan ke byte
 *      akhir. Terverifikasi lokal + pemeriksaan mata dua kasus.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pdfMakeImport from "pdfmake/build/pdfmake";
import vfsImport from "pdfmake/build/vfs_fonts";
import { describe, expect, it } from "vitest";
import { buildHarianModel, type HarianInput } from "@/lib/harian-model";
import type { DailyGlRow, DailySalesRow, SyncRow, UnitCoverageRow } from "@/lib/queries";
import type { ScopedUnit, ScopedUnitId } from "@/lib/scope-rule";
import { buildHarianDocDefinition, type HarianDocMeta } from "./harian-doc";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pdfMake: any = (pdfMakeImport as any).default ?? pdfMakeImport;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vfsAny: any = (vfsImport as any).default ?? vfsImport;
pdfMake.vfs = vfsAny.pdfMake?.vfs ?? vfsAny.vfs ?? vfsAny;

/** Kumpulkan semua string `text` dari pohon docDefinition + footer. */
function collectDocText(doc: { content: unknown; footer?: (a: number, b: number) => unknown }): string {
  const parts: string[] = [];
  const walk = (n: unknown): void => {
    if (n == null) return;
    if (typeof n === "string") {
      parts.push(n);
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (typeof n === "object") {
      const o = n as Record<string, unknown>;
      if ("text" in o) walk(o.text);
      for (const k of ["stack", "columns", "table", "body", "ul", "ol"]) if (k in o) walk(o[k]);
    }
  };
  walk(doc.content);
  if (doc.footer) walk(doc.footer(1, 3));
  return parts.join(" ");
}

let hasPdftotext = false;
try {
  execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
  hasPdftotext = true;
} catch {
  hasPdftotext = false;
}
function pdftotext(buf: Buffer): string {
  const f = join(mkdtempSync(join(tmpdir(), "hpdf-")), "d.pdf");
  writeFileSync(f, buf);
  return execFileSync("pdftotext", ["-layout", f, "-"], { encoding: "utf8" });
}
function render(doc: unknown): Promise<Buffer> {
  return new Promise((r) => pdfMake.createPdf(doc).getBuffer((b: Buffer) => r(b)));
}

const U = (id: number, code: string, name: string): ScopedUnit => ({ unit_id: id as ScopedUnitId, code, name });
const UNITS = [U(1, "6478111", "Imam Bonjol"), U(2, "6378301", "Bakau"), U(3, "6478101", "Adisucipto")];
const sale = (u: number, d: string, nama: string, vol: number): DailySalesRow => ({ unit_id: u, d, ckdbbm: "BB-x", nama, vol, omzet: vol * 10000 });
const cov = (u: number, m: string | null): UnitCoverageRow => ({ unit_id: u, sales_min: m });
const syn = (u: number, r: string): SyncRow => ({ unit_id: u, last_run: r });
const glRow = (d: string, gl: number, prov = false): DailyGlRow => ({ d, ckdbbm: "BB-03", nama: "SOLAR", fisik: 1, fisik_prev: 1, pen_do: 0, sales_gross: 0, tera: 0, gl, excluded_tanks: 0, provisional: prov });
const META: HarianDocMeta = { ptLabel: "PT Uji", dateLong: "Rabu, 22 Juli 2026", unitsCount: 3, divisor: 22, generatedLabel: "x", freshnessLabel: "sinkron terlama: Bakau, 34 jam lalu" };

function base(over: Partial<HarianInput> = {}): HarianInput {
  return {
    units: UNITS, date: "2026-07-22",
    dailySales: UNITS.flatMap((u) => [sale(u.unit_id, "2026-07-21", "SOLAR", 1000), sale(u.unit_id, "2026-07-22", "SOLAR", 1000)]),
    gl: new Map(UNITS.map((u) => [u.unit_id as number, [glRow("2026-07-21", 10), glRow("2026-07-22", 20)]])),
    coverage: UNITS.map((u) => cov(u.unit_id, "2020-01-01")),
    sync: UNITS.map((u) => syn(u.unit_id, "2026-07-24T07:00:00Z")),
    recordFloor: "2025-12-29",
    ...over,
  };
}
const doc = (input: HarianInput) => buildHarianDocDefinition({ model: buildHarianModel(input), meta: META }) as unknown as { content: unknown; footer?: (a: number, b: number) => unknown };
const staleInput = () =>
  base({ dailySales: UNITS.flatMap((u) => (u.code === "6378301" ? [sale(u.unit_id, "2026-07-20", "SOLAR", 1000)] : [sale(u.unit_id, "2026-07-21", "SOLAR", 1000), sale(u.unit_id, "2026-07-22", "SOLAR", 1000)])) });
const provInput = () => base({ gl: new Map(UNITS.map((u) => [u.unit_id as number, [glRow("2026-07-21", 10), glRow("2026-07-22", 20, true)]])) });

describe("penanda WAJIB — doc-tree (jalan di CI)", () => {
  it("BANNER data-basi HADIR saat incomplete, ABSEN saat lengkap (dua arah)", () => {
    const t = collectDocText(doc(staleInput()));
    expect(t).toContain("TOTAL TIDAK LENGKAP");
    expect(t).toContain("Bakau");
    expect(collectDocText(doc(base()))).not.toContain("TOTAL TIDAK LENGKAP");
  });

  it("kolom unit basi bertanda (⚠→!) + baris 's/d'; TOTAL bertanda", () => {
    // Header via pdfText: ⚠→"!" (makna dibawa warna+label; glyph pengganti aman).
    const t = collectDocText(doc(staleInput()));
    expect(t).toContain("! Bakau");
    expect(t).toContain("s/d ");
    expect(t).toContain("TOTAL !");
  });

  it("PROVISIONAL → 'SEMENTARA' HADIR saat provisional, ABSEN saat final (dua arah)", () => {
    expect(collectDocText(doc(provInput()))).toContain("SEMENTARA");
    expect(collectDocText(doc(base()))).not.toContain("SEMENTARA");
  });

  it("penutup-nol (glSuspect) → catatan kaki 28 Oktober", () => {
    expect(collectDocText(doc(base({ glSuspect: new Set([2]) })))).toContain("penutup opname bernilai 0");
  });

  it("Pertalite Khusus catatan kaki selalu ada, kata-kata benar", () => {
    const t = collectDocText(doc(base()));
    expect(t).toContain("0 liter sepanjang periode laporan");
    expect(t).not.toContain("tidak ada di master");
  });

  it("footer memuat kesegaran MIN + nama unit + 'Halaman X dari Y'", () => {
    const t = collectDocText(doc(base()));
    expect(t).toContain("sinkron terlama: Bakau");
    expect(t).toContain("Halaman 1 dari 3");
  });
});

const dPt = hasPdftotext ? describe : describe.skip;
dPt("penanda WAJIB — byte-level via pdftotext (bonus, lokal)", () => {
  it("banner + SEMENTARA benar-benar tercetak di byte PDF", async () => {
    expect(pdftotext(await render(buildHarianDocDefinition({ model: buildHarianModel(staleInput()), meta: META })))).toContain("TIDAK LENGKAP");
    expect(pdftotext(await render(buildHarianDocDefinition({ model: buildHarianModel(provInput()), meta: META })))).toContain("SEMENTARA");
  });
});
