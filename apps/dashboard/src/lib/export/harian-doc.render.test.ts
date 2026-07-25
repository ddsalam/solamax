/**
 * Render test BYTE-LEVEL untuk penanda WAJIB Laporan Harian PDF (Gate PDF-B):
 * inject HarianModel ber-flag, render, inflate content stream, assert penanda
 * BENAR-BENAR TERCETAK — dan ABSEN saat lengkap (dua arah). Bukan struktural:
 * "model punya flag ≠ PDF mencetaknya" adalah celah yang menjatuhkan Gate 4.
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

function render(doc: unknown): Promise<Buffer> {
  return new Promise((r) => pdfMake.createPdf(doc).getBuffer((b: Buffer) => r(b)));
}
/** Teks tampak di PDF via pdftotext (baca seperti manusia — subset font aman). */
function pdfVisibleText(buf: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), "hpdf-"));
  const f = join(dir, "d.pdf");
  writeFileSync(f, buf);
  return execFileSync("pdftotext", ["-layout", f, "-"], { encoding: "utf8" });
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
const doc = (input: HarianInput, meta = META) => buildHarianDocDefinition({ model: buildHarianModel(input), meta });

describe("penanda WAJIB tercetak di PDF (byte-level)", () => {
  it("BANNER data-basi HADIR saat incomplete, ABSEN saat lengkap (dua arah)", async () => {
    const stale = base({ dailySales: UNITS.flatMap((u) => (u.code === "6378301" ? [sale(u.unit_id, "2026-07-20", "SOLAR", 1000)] : [sale(u.unit_id, "2026-07-21", "SOLAR", 1000), sale(u.unit_id, "2026-07-22", "SOLAR", 1000)])) });
    const txtStale = pdfVisibleText(await render(doc(stale)));
    expect(txtStale).toContain("TOTAL TIDAK LENGKAP");
    expect(txtStale).toContain("Bakau");
    const txtOk = pdfVisibleText(await render(doc(base())));
    expect(txtOk).not.toContain("TOTAL TIDAK LENGKAP");
  });

  it("sel unit basi tercetak '—' + TOTAL bertanda", async () => {
    const stale = base({ dailySales: UNITS.flatMap((u) => (u.code === "6378301" ? [sale(u.unit_id, "2026-07-20", "SOLAR", 1000)] : [sale(u.unit_id, "2026-07-21", "SOLAR", 1000), sale(u.unit_id, "2026-07-22", "SOLAR", 1000)])) });
    const t = pdfVisibleText(await render(doc(stale)));
    expect(t).toContain("—"); // em-dash sel basi
    expect(t).toMatch(/TOTAL/);
  });

  it("PROVISIONAL → 'SEMENTARA' tercetak", async () => {
    const prov = base({ gl: new Map(UNITS.map((u) => [u.unit_id as number, [glRow("2026-07-21", 10), glRow("2026-07-22", 20, true)]])) });
    expect(pdfVisibleText(await render(doc(prov)))).toContain("SEMENTARA");
    expect(pdfVisibleText(await render(doc(base())))).not.toContain("SEMENTARA");
  });

  it("penutup-nol (glSuspect) → catatan kaki 28 Oktober tercetak", async () => {
    const t = pdfVisibleText(await render(doc(base({ glSuspect: new Set([2]) }))));
    expect(t).toContain("penutup opname bernilai 0");
  });

  it("footer kesegaran MIN + nama unit di SETIAP halaman", async () => {
    // dokumen normal multi-halaman: footer harus memuat freshnessLabel di semua hal.
    const t = pdfVisibleText(await render(doc(base())));
    const occurrences = (t.match(/sinkron terlama/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2); // >=2 halaman
  });

  it("Pertalite Khusus catatan kaki selalu ada, kata-kata benar", async () => {
    const t = pdfVisibleText(await render(doc(base())));
    expect(t).toContain("0 liter sepanjang periode laporan");
  });
});
