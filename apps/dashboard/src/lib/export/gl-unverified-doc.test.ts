import { describe, expect, it } from "vitest";
import { buildLaporanModel, type LaporanRaw } from "@/lib/laporan-model";
import type { DailyGlRow } from "@/lib/queries";
import { DEFAULT_EXPORT_CONFIG } from "./config";
import { glUnverifiedSection } from "./gl-unverified-doc";
import { buildLaporanDocDefinition, type LaporanDocMeta } from "./laporan-doc";

const zero: DailyGlRow = {
  d: "2026-06-11", ckdbbm: "P", nama: "SINTETIS P", fisik_prev: 6_000, fisik: 0, pen_do: 0,
  sales_gross: 30, tera: 0, gl: null, gl_raw: -5_970, gl_suspect: "penutup_nol",
  movement_invalid: false, excluded_tanks: 0, provisional: true,
};
const RAW = {
  prodDay: [{ ckdbbm: "P", nama: "SINTETIS P", vol: 30, omzet: 300_000, harga: 10_000 }],
  prodMonth: [{ ckdbbm: "P", nama: "SINTETIS P", vol: 30, omzet: 300_000, harga: 10_000 }],
  glRows: [zero], zeroClosing: [], delivMonth: [], doDay: [], doAnomalies: [], doSuspects: [],
  shift: { shifts: 3, last_dtgljam: null }, hargaDeviasi: [], corrections: 0, cash: [],
  saldo: { awal: { piutangLokal: 0, piutangOnline: 0, hutangLokal: 0 }, akhir: { piutangLokal: 0, piutangOnline: 0, hutangLokal: 0 } },
  recapPelanggan: [], recapEdc: [], recapDeposit: [], recapPendapatanLain: [], recapPengeluaran: [], recapSetoran: [],
  terra: [], tetanggaSebelum: { f: [], g: [], i: [] }, tetanggaSesudah: { f: [], g: [], i: [] },
} as unknown as LaporanRaw;
const META: LaporanDocMeta = { unitDotted: "SYNTHETIC", unitName: "SYNTHETIC", dateLong: "Kamis, 11 Juni 2026",
  monthName: "Juni", dayOfMonth: 11, daysInMonth: 30, staleDays: 30, generatedLabel: "x" };
const ctx = (detail: boolean) => ({ unitCode: "SYNTHETIC", date: "2026-06-11", today: "2026-07-02",
  mi: { month: 6, year: 2026, dayOfMonth: 11, daysInMonth: 30 }, detail });

describe("glUnverifiedSection (PDF)", () => {
  it("is omitted when nothing is withheld", () => {
    expect(glUnverifiedSection([], { hint: "x" })).toEqual([]);
  });

  it.each([true, false])("operational PDF (detail=%s) carries the section, raw audit and steps — not only in Arus", (detail) => {
    const m = buildLaporanModel(RAW, ctx(detail));
    const doc = buildLaporanDocDefinition({ model: m, meta: META, config: { ...DEFAULT_EXPORT_CONFIG, detail } });
    const json = JSON.stringify(doc.content);
    expect(json).toContain("G/L Belum terverifikasi");
    expect(json).toContain("= -5.970,00 L");
    expect(json).toContain("Cara memverifikasi");
    expect(json.includes("Arus Minyak Harian")).toBe(detail);
    // Withheld from total, percentage and alarms: no signed total and no fired G/L alarm.
    expect(m.sales.glTotal).toBeNull();
    expect(m.checks.filter((c) => c.label.startsWith("G/L")).every((c) => c.state === "na")).toBe(true);
    expect(json).not.toMatch(/bukan kerugian|artefak/i);
    expect(json).not.toMatch(/NaN|undefined/);
    // The heading is paired with its table (orphan guard applies).
    const content = doc.content as unknown as Record<string, unknown>[];
    const heading = content.find((c) => JSON.stringify(c).startsWith('{"columns":[{"text":"G/L Belum terverifikasi"'))!;
    expect(heading.id).toMatch(/^keep-\d+$/);
    expect(content.some((c) => c.id === `${heading.id as string}-body`)).toBe(true);
  });
});
