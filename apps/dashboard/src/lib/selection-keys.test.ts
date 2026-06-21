import { describe, expect, it } from "vitest";
import { deriveTopbarSelection } from "./selection-keys";

/**
 * Mengunci sinkronisasi picker ↔ URL. Di rute laporan, URL otoritatif (cegah
 * desync saat layout grup tak re-render & cookie basi). Di rute grup-wide → seed.
 */
describe("deriveTopbarSelection — picker cermin URL di rute laporan", () => {
  const SEED_UNIT = "6478111";
  const SEED_DATE = "2026-06-18"; // cookie basi

  it("rincian: tanggal dari URL menang atas seed cookie", () => {
    const r = deriveTopbarSelection("/unit/6478111/rincian/2026-06-14", SEED_UNIT, SEED_DATE);
    expect(r).toEqual({ unit: "6478111", date: "2026-06-14", onReportRoute: true });
  });

  it("laporan: tanggal dari URL menang (?view diabaikan oleh path)", () => {
    const r = deriveTopbarSelection("/unit/6478111/laporan/2026-06-15", SEED_UNIT, SEED_DATE);
    expect(r).toEqual({ unit: "6478111", date: "2026-06-15", onReportRoute: true });
  });

  it("UNIT desync: code dari URL menang atas seed unit", () => {
    const r = deriveTopbarSelection("/unit/6478333/rincian/2026-06-14", SEED_UNIT, SEED_DATE);
    expect(r.unit).toBe("6478333");
    expect(r.date).toBe("2026-06-14");
  });

  it("grup-wide (board): pakai seed cookie", () => {
    const r = deriveTopbarSelection("/board", SEED_UNIT, SEED_DATE);
    expect(r).toEqual({ unit: SEED_UNIT, date: SEED_DATE, onReportRoute: false });
  });

  it("grup-wide (ketaatan / beranda / denah): pakai seed", () => {
    for (const p of ["/monitoring/ketaatan", "/", "/monitoring/denah/6478111"]) {
      expect(deriveTopbarSelection(p, SEED_UNIT, SEED_DATE).onReportRoute).toBe(false);
    }
  });
});
